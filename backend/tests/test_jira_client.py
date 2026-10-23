"""Shared Jira transport remains functional after the legacy scheduler is removed."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.security import encrypt_credential
from app.services.jira_client import JiraClient, platform_password


class JiraClientTests(unittest.IsolatedAsyncioTestCase):
    def account(self):
        return SimpleNamespace(
            base_url="https://jira.example.test/customer",
            username="test-user",
            password_encrypted=encrypt_credential("test-password", "platform"),
        )

    async def test_authenticated_comment_pagination(self):
        requests = []

        def respond(request):
            requests.append(request)
            start = int(request.url.params["startAt"])
            self.assertEqual(
                request.url.path, "/customer/rest/api/2/issue/TEST-1/comment"
            )
            self.assertTrue(request.headers["Authorization"].startswith("Basic "))
            return httpx.Response(
                200, json={"comments": [{"body": str(start)}], "total": 2}
            )

        factory = httpx.AsyncClient
        with patch(
            "app.services.jira_client.httpx.AsyncClient",
            side_effect=lambda **kw: factory(
                transport=httpx.MockTransport(respond), **kw
            ),
        ):
            async with JiraClient(self.account()) as client:
                comments = await client.comments("TEST-1")
        self.assertEqual([comment["body"] for comment in comments], ["0", "1"])
        self.assertEqual(len(requests), 2)
        self.assertTrue(client.client.is_closed)

    async def test_failed_auth_does_not_expose_upstream_response(self):
        factory = httpx.AsyncClient
        transport = httpx.MockTransport(
            lambda _: httpx.Response(401, text="private upstream detail")
        )
        with patch(
            "app.services.jira_client.httpx.AsyncClient",
            side_effect=lambda **kw: factory(transport=transport, **kw),
        ):
            async with JiraClient(self.account()) as client:
                with self.assertRaises(HTTPException) as raised:
                    await client.get("issue/TEST-1")
        self.assertEqual(raised.exception.status_code, 422)
        self.assertNotIn("private upstream detail", raised.exception.detail)

    def test_mail_ciphertext_cannot_be_used_as_platform_password(self):
        account = self.account()
        account.password_encrypted = encrypt_credential("test-password", "mail")
        with self.assertRaises(HTTPException) as raised:
            platform_password(account)
        self.assertEqual(raised.exception.status_code, 422)
