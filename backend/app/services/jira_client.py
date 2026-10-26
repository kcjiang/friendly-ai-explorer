"""Jira REST transport for workbench issue and comment collection."""

from urllib.parse import quote

import httpx
from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from app.i18n import message as system_message
from app.security import decrypt_credential
from app.services.workbench_resources import validate_source_url


def platform_password(account):
    try:
        return decrypt_credential(account.password_encrypted, "platform")
    except InvalidToken:
        raise HTTPException(
            422,
            system_message(
                "errors.cannotDecryptAccountCredentialsSaveThePasswordAgain"
            ),
        ) from None


class JiraClient:
    def __init__(self, account):
        validate_source_url(account.base_url)
        self.client = httpx.AsyncClient(
            base_url=account.base_url + "/",
            auth=(account.username, platform_password(account)),
            timeout=30,
            follow_redirects=False,
            headers={"Accept": "application/json"},
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.client.aclose()

    async def get(self, path, params=None):
        try:
            response = await self.client.get("rest/api/2/" + path, params=params)
        except httpx.HTTPError:
            raise HTTPException(
                502,
                system_message(
                    "errors.jiraRequestFailedCheckTheNetworkSiteUrlAndHttpsCertificate"
                ),
            ) from None
        if response.status_code in (401, 403):
            raise HTTPException(
                422,
                system_message(
                    "errors.jiraAuthenticationFailedOrAccessDeniedCheckThePasswordAccountStatusAnd"
                ),
            )
        if response.status_code != 200:
            raise HTTPException(
                502, f"Jira 返回 HTTP {response.status_code}，请检查 API 或登录策略"
            )
        try:
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except ValueError:
            raise HTTPException(
                502,
                system_message(
                    "errors.jiraDidNotReturnApiDataAnAdministratorMayNeedToEnable"
                ),
            ) from None

    async def comments(self, key):
        result, start = [], 0
        while True:
            data = await self.get(
                f"issue/{quote(key, safe='')}/comment",
                {"startAt": start, "maxResults": 100},
            )
            batch = data.get("comments", [])
            result.extend(
                {
                    "author": c.get("author", {}).get("displayName", ""),
                    "body": c.get("body", ""),
                    "created": c.get("created"),
                }
                for c in batch
            )
            start += len(batch)
            if start >= data.get("total", start):
                return result
            if not batch or start >= 10000:
                raise HTTPException(
                    422,
                    system_message(
                        "errors.commentPaginationWasInterruptedACompleteDataCopyCannotBeCreated"
                    ),
                )
