"""Minimal message factory for workflow tests; collection has separate integration tests."""

from app.models.workbench import WBMessage, now
from app.services.workbench_limits import RETENTION


async def create_message(db, account, key="FAE-1"):
    row = WBMessage(
        user_id=account.user_id,
        account_id=account.id,
        project_id=account.project_id,
        source_key=key,
        payload={
            "key": key,
            "title": "断连问题",
            "body": "原始反馈",
            "url": "",
            "attachments": [],
        },
        received_at=now(),
        expires_at=now() + RETENTION,
    )
    db.add(row)
    await db.flush()
    return row
