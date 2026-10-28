"""Discover immediate disk children in one batch; serialize only the requested page."""

from sqlalchemy import func, select

from app.models.storage import StorageEntry
from app.services import storage_service as s


async def page(
    db, user, space, path, shared_id, query, number, size, sort="name", direction="asc"
):
    s.clean_path(path)
    if shared_id:
        root = await s.entry_for(db, shared_id, user)
        if not root.is_dir:
            return {"items": [await s.serialize(db, root)], "total": 1, "page": number}
        space = root.space
        path = "/".join(filter(None, [root.path, path]))
        check = await s.active(db, space, path)
        if not check:
            s.fail(404, "文件夹不存在")
        await s.assert_read(db, check, user)
    else:
        s.assert_write(space, user)
    directory = s.disk_path(space, path)
    if not path:
        directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        s.fail(404, "文件夹不存在")
    parent = func.regexp_replace(StorageEntry.path, r"/?[^/]+$", "")
    base = select(StorageEntry).where(
        StorageEntry.space == space, StorageEntry.trash_id.is_(None), parent == path
    )
    known = {e.path: e for e in (await db.scalars(base)).all()}
    for child in directory.iterdir():
        if child.is_symlink():
            continue
        rel = child.relative_to(s.space_root(space)).as_posix()
        entry = known.get(rel)
        if not entry:
            entry = await s.register(db, space, rel)
        if not entry.is_dir:
            entry.size = child.stat().st_size
    await db.flush()
    if query:
        filename = func.regexp_replace(StorageEntry.path, "^.*/", "")
        base = base.where(filename.icontains(query, autoescape=True))
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    order = {
        "name": func.lower(StorageEntry.path),
        "size": StorageEntry.size,
        "updated_at": StorageEntry.updated_at,
    }[sort]
    rows = (
        await db.scalars(
            base.order_by(
                StorageEntry.is_dir.desc(),
                order.desc() if direction == "desc" else order.asc(),
                func.lower(StorageEntry.path),
                StorageEntry.id,
            )
            .offset((number - 1) * size)
            .limit(size)
        )
    ).all()
    return {
        "items": [await s.serialize(db, e) for e in rows],
        "total": total,
        "page": number,
    }
