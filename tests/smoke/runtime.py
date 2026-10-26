"""Production image regression checks against the disposable Compose test stack."""

import re

import httpx


def ok(response):
    response.raise_for_status()
    assert response.status_code == 200, response.request.url.path
    return response


with httpx.Client(base_url="http://frontend:3000", timeout=30) as client:
    for preferred, expected in [
        ("en-US", "en"),
        ("zh-CN", "zh-CN"),
        ("zh-TW", "en"),
        ("vi-VN", "en"),
    ]:
        html = ok(client.get("/login", headers={"Accept-Language": preferred})).text
        assert re.search(r'<html[^>]*lang="([^"]+)"', html)[1] == expected
    client.cookies.set("FAE_LOCALE", "zh-CN")
    assert (
        'lang="zh-CN"'
        in ok(client.get("/login", headers={"Accept-Language": "en"})).text
    )
    client.cookies.clear()
    assert client.get("/").status_code in (302, 307)
    csrf = ok(client.get("/api/auth/csrf")).json()["csrfToken"]
    ok(
        client.post(
            "/api/auth/callback/credentials",
            data={"csrfToken": csrf, "email": "dev@kaicheng.me", "password": "123456"},
            headers={"X-Auth-Return-Redirect": "1"},
        )
    )
    session = ok(client.get("/api/auth/session")).json()
    assert session["user"]["email"] == "dev@kaicheng.me"
    assert session["user"]["role"] == "developer"
    for path in ("/", "/workbench", "/admin", "/ticket", "/catalog", "/knowledge"):
        ok(client.get(path))
with httpx.Client(
    base_url="http://backend:8000",
    headers={"Authorization": f"Bearer {session['accessToken']}"},
    timeout=30,
) as client:
    for path in (
        "/api/v1/tickets/",
        "/api/v1/knowledge/",
        "/api/v1/workbench",
        "/api/v1/workbench/mail",
    ):
        ok(client.get(path))
print(
    "PASS: production images, language selection, NextAuth session, protected pages and backend APIs"
)
