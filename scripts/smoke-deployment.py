"""Run inside the backend container against an isolated deployment.

Requires FAE_SMOKE_PASSWORD; optionally set FAE_SMOKE_EMAIL / FAE_SMOKE_HOST.
Pass --upload once, then run again after recreating containers to check persistence.
Never prints credentials or tokens. Does not call external AI/email services.
"""
import os
import sys
import httpx

email = os.environ.get("FAE_SMOKE_EMAIL", "dev@kaicheng.me")
password = os.environ["FAE_SMOKE_PASSWORD"]
host = os.environ.get("FAE_SMOKE_HOST", "localhost:18080")
content = b"FAE deployment persistence smoke test\n"
marker = "fae-deployment-smoke"


def ok(response, expected=200):
    assert response.status_code == expected, f"{response.request.url.path}: HTTP {response.status_code}"
    return response


with httpx.Client(base_url="http://nginx", headers={"Host": host}, timeout=30) as client:
    ok(client.get("/nginx-health"))
    ok(client.get("/login"))
    assert client.get("/").status_code in (302, 307)
    csrf = ok(client.get("/api/auth/csrf")).json()["csrfToken"]
    ok(client.post("/api/auth/callback/credentials", data={
        "csrfToken": csrf, "email": email, "password": password,
        "callbackUrl": f"http://{host}/",
    }, headers={"X-Auth-Return-Redirect": "1"}))
    session = ok(client.get("/api/auth/session")).json()
    assert session.get("user", {}).get("email") == email, "NextAuth login failed"
    assert session.get("accessToken"), "Missing backend token in session"
    ok(client.get("/"))
    print("PASS: Nginx, login page, NextAuth credentials, session and protected page")

    client.headers["Authorization"] = f"Bearer {session['accessToken']}"
    for path in ("/api/v1/tickets/", "/api/v1/knowledge/", "/api/v1/email/emails",
                 "/api/v1/debug/commands?device_type=adb"):
        ok(client.get(path))
    print("PASS: authenticated database APIs and initialized module tables")

    if "--upload" in sys.argv:
        ok(client.post("/api/v1/debug/logs", files={"file": ("smoke.txt", content, "text/plain")},
                       data={"device_type": "adb", "description": marker}), 201)
    logs = ok(client.get("/api/v1/debug/logs?device_type=adb")).json()
    matching = [entry for entry in logs if entry.get("description") == marker]
    assert matching, "No smoke upload found; run with --upload once"
    entry = matching[0]
    downloaded = ok(client.get(f"/api/v1/debug/logs/{entry['id']}/download"))
    assert downloaded.content == content, "Upload/download content mismatch"
    static = ok(client.get(f"/uploads/device_logs/{entry['filename']}"))
    assert static.content == content, "Static upload proxy mismatch"
    print("PASS: persisted upload record, authenticated download and /uploads proxy")
