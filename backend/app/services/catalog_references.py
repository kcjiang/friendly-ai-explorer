"""Reference validation holds share locks until commit to serialize with deletion."""

from fastapi import HTTPException
from sqlalchemy import select

from app.i18n import message as system_message


async def require_active(db, model, record_id, label):
    record = await db.scalar(
        select(model)
        .where(model.id == record_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if not record or record.deleted_at is not None:
        raise HTTPException(422, system_message("errors.referenceInvalid"))
    return record
