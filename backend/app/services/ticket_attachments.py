import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.models.storage import StorageEntry, UploadTask
from app.services import storage_service as s


async def bind(db, user, ticket, upload_ids):
    moved = []
    try:
        for task_id in dict.fromkeys(upload_ids):
            task = await db.scalar(
                select(UploadTask)
                .where(UploadTask.id == task_id, UploadTask.user_id == user.id)
                .with_for_update()
            )
            if (
                not task
                or task.purpose != "attachment"
                or task.status != "complete"
                or not task.entry_id
                or task.expires_at < datetime.now(timezone.utc)
            ):
                s.fail(409, "附件尚未上传完成或已经失效")
            if task.context.get("ticket_id") not in (None, str(ticket.id)):
                s.fail(403, "无权操作此空间")
            entry = await db.get(StorageEntry, task.entry_id)
            if entry and entry.ticket_id == ticket.id:
                continue
            if (
                not entry
                or entry.space != f"draft/{user.id}"
                or entry.creator_id != user.id
            ):
                s.fail(409, "附件已关联到其他记录")
            old = s.disk_path(entry.space, entry.path)
            space = f"ticket/{ticket.id}"
            root = s.disk_path(space)
            root.mkdir(parents=True, exist_ok=True)
            name = s.available_name(root, Path(entry.path).name)
            target = s.disk_path(space, name)
            journal = (
                Path(settings.storage_dir).resolve()
                / "attachment-transfers"
                / f"{entry.id}.json"
            )
            journal.parent.mkdir(parents=True, exist_ok=True)
            journal.write_text(
                json.dumps(
                    {
                        "entry_id": str(entry.id),
                        "old_space": entry.space,
                        "old_path": entry.path,
                        "space": space,
                        "path": name,
                    }
                ),
                encoding="utf-8",
            )
            old.rename(target)
            moved.append((old, target, journal))
            entry.space = space
            entry.path = name
            entry.ticket_id = ticket.id
            task.context = {**task.context, "bound": True, "ticket_id": str(ticket.id)}
            s.record(
                db,
                user,
                entry,
                "upload_attachment",
                ticket_id=str(ticket.id),
                name=name,
                size=entry.size,
                creator_id=str(entry.creator_id),
                creator_name=user.name,
            )
        await db.flush()
        return moved
    except BaseException:
        rollback_paths(moved)
        raise


def rollback_paths(paths):
    for old, new, journal in reversed(paths):
        if new.exists() and not old.exists():
            old.parent.mkdir(parents=True, exist_ok=True)
            new.rename(old)
        journal.unlink(missing_ok=True)


def finalize_paths(paths):
    # The database now owns the new paths. Any cleanup failure can safely be
    # retried by maintenance; never roll back a committed attachment move.
    for old, _, journal in paths:
        try:
            journal.unlink(missing_ok=True)
            old.parent.rmdir()
        except OSError:
            pass


async def all_for(db, ticket_id, user):
    from fastapi import HTTPException

    rows = (
        await db.scalars(
            select(StorageEntry)
            .where(StorageEntry.ticket_id == ticket_id)
            .order_by(StorageEntry.created_at)
        )
    ).all()
    result = []
    for entry in rows:
        try:
            await s.assert_read(db, entry, user)
            result.append(await s.serialize(db, entry))
        except HTTPException as e:
            if e.status_code not in (403, 404):
                raise
    return result


async def queue_ticket(db, user, ticket_id):
    from app.services.storage_maintenance import queue_entries

    query = select(StorageEntry).where(StorageEntry.ticket_id == ticket_id)
    entries = (await db.scalars(query)).all()
    if entries:
        s.record(
            db,
            user,
            entries[0],
            "delete_ticket_attachments",
            ticket_id=str(ticket_id),
            count=len(entries),
            size=sum(e.size + e.thumbnail_size for e in entries),
        )
    await queue_entries(db, user, entries, "delete_ticket_attachments")
    tasks = (
        await db.scalars(
            select(UploadTask)
            .where(
                UploadTask.purpose == "attachment",
                UploadTask.context["ticket_id"].astext == str(ticket_id),
            )
            .with_for_update()
        )
    ).all()
    for task in tasks:
        if task.entry_id:
            draft = await db.get(StorageEntry, task.entry_id)
            if draft and draft.space.startswith("draft/"):
                await queue_entries(db, user, [draft], "cancel_attachment")
        task.status = "cancelled"
        task.reserved_bytes = 0


async def delete_files(db, user, ticket, entry_ids):
    from app.services.storage_maintenance import queue_entries

    entries = []
    for ident in dict.fromkeys(entry_ids):
        entry = await db.get(StorageEntry, ident)
        if not entry or entry.ticket_id != ticket.id:
            s.fail(404, "文件不存在")
        entries.append(entry)
    await queue_entries(db, user, entries, "delete_attachment")


async def archive(db, user, query="", page=1, page_size=50):
    from sqlalchemy import func, or_

    from app.models.ticket import Ticket

    base = (
        select(StorageEntry, Ticket)
        .join(Ticket, Ticket.id == StorageEntry.ticket_id)
        .where(StorageEntry.creator_id == user.id, StorageEntry.trash_id.is_(None))
    )
    if query:
        base = base.where(
            or_(
                StorageEntry.path.icontains(query, autoescape=True),
                Ticket.title.icontains(query, autoescape=True),
                Ticket.ticket_no.icontains(query, autoescape=True),
            )
        )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    rows = (
        await db.execute(
            base.order_by(StorageEntry.created_at.desc(), StorageEntry.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = []
    for entry, ticket in rows:
        s.require_ticket_view(ticket, user)
        value = await s.serialize(db, entry)
        value["ticket_name"] = f"{ticket.ticket_no} · {ticket.title}"
        items.append(value)
    return {"items": items, "total": total, "page": page}
