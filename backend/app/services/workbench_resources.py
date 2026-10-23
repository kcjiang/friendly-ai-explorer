"""Host validation and canonical resource payloads."""

from urllib.parse import urlsplit

from fastapi import HTTPException


def validate_source_url(url):
    """Any configured HTTPS endpoint is allowed; never send credentials over HTTP."""
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise HTTPException(
            422, "请填写有效的 HTTPS 平台根地址，不含账号、查询参数或片段"
        )


def resource_payload(key, title, body, url=""):
    return {
        "key": str(key)[:200],
        "title": str(title)[:500] or "(无标题)",
        "body": str(body)[:100000],
        "url": url,
        "attachments": [],
    }
