from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.models.catalog import Project
from app.models.workbench import (
    WBAccount,
    WBAutomation,
    WBDebugEvent,
    WBCheck,
    WBJob,
    WBMessage,
    WBPreference,
    now,
)
from app.models.workbench_mail import WBMail, WBMailbox, WBMailLocation, WBMessageMail
from app.schemas.workbench import Account, Automation, Note, Reorder, Schedule, Submit
from app.services import workbench_service as service
from app.services.workbench_checks import enqueue_manual, public_check
from app.security import encrypt_credential
from app.services.workbench_limits import (
    MAX_CONFIGURATIONS,
    MAX_DEBUG_RESPONSE_CHARS,
    MAX_JOB_LOG_ENTRIES,
)
from app.services.workbench_mail_service import owned_folder
from app.services.workbench_resources import validate_source_url
from app.services.workbench_schedule import next_slot

router = APIRouter()


@router.get("/debug")
async def debug_output(
    user: AnyUser, after: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)
):
    query = select(WBDebugEvent).where(
        WBDebugEvent.user_id == user.id, WBDebugEvent.expires_at > now()
    )
    if after:
        rows = list(
            (
                await db.scalars(
                    query.where(WBDebugEvent.id > after)
                    .order_by(WBDebugEvent.id)
                    .limit(100)
                )
            ).all()
        )
    else:
        latest = list(
            (await db.scalars(query.order_by(WBDebugEvent.id.desc()).limit(100))).all()
        )
        rows, size = [], 0
        for row in latest:
            if size + len(row.output) > MAX_DEBUG_RESPONSE_CHARS:
                break
            rows.append(row)
            size += len(row.output)
        rows.reverse()
    bounded, size = [], 0
    for row in rows:
        if size + len(row.output) > MAX_DEBUG_RESPONSE_CHARS:
            break
        bounded.append(row)
        size += len(row.output)
    return {"events": [{"id": row.id, "output": row.output} for row in bounded]}


@router.get("")
async def overview(
    user: AnyUser,
    since: datetime | None = None,
    until: datetime | None = None,
    account_id: UUID | None = None,
    state: str = Query("pending", pattern="^(pending|processed|ignored)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    if (since and since.tzinfo is None) or (until and until.tzinfo is None):
        raise HTTPException(422, "时间范围必须包含时区")
    lower = max(since or now() - service.RETENTION, now() - service.RETENTION)
    upper = until or now()
    if lower > upper:
        raise HTTPException(422, "开始时间不能晚于结束时间")
    pref = await service.initialize(db, user.id)
    await db.commit()
    result = {
        "schedule": {
            k: v for k, v in pref.schedule.items() if k in Schedule.model_fields
        },
        "schedule_configured": bool(pref.schedule.get("_configured")),
        "next_run_at": pref.next_run_at,
        "last_run_at": pref.last_run_at,
        "manual_check": public_check(
            await db.scalar(
                select(WBCheck)
                .where(WBCheck.user_id == user.id, WBCheck.origin == "manual")
                .order_by(WBCheck.id.desc())
                .limit(1)
            )
        ),
    }
    for name, model in [("accounts", WBAccount), ("automations", WBAutomation)]:
        result[name] = [
            service.public(row)
            for row in (
                await db.scalars(
                    select(model)
                    .where(model.user_id == user.id, model.deleted_at.is_(None))
                    .order_by(model.position, model.id)
                )
            ).all()
        ]
    result["has_mailboxes"] = bool(
        await db.scalar(
            select(WBMailbox.id).where(WBMailbox.user_id == user.id).limit(1)
        )
    )
    base = select(WBMessage).where(
        WBMessage.user_id == user.id,
        WBMessage.account_id.in_(
            select(WBAccount.id).where(WBAccount.deleted_at.is_(None))
        ),
        WBMessage.received_at >= lower,
        WBMessage.received_at <= upper,
        WBMessage.expires_at > now(),
    )
    base = (
        base.where(WBMessage.dismissed)
        if state == "ignored"
        else base.where(
            ~WBMessage.dismissed,
            WBMessage.submitted if state == "processed" else ~WBMessage.submitted,
        )
    )
    if account_id:
        base = base.where(WBMessage.account_id == account_id)
    result["total_messages"] = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )
    page = min(page, max(1, (result["total_messages"] + page_size - 1) // page_size))
    result["page"], result["page_size"] = page, page_size
    result["messages"] = [
        service.public(row)
        for row in (
            await db.scalars(
                base.order_by(WBMessage.received_at, WBMessage.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    ]
    for message in result["messages"]:
        message["payload"] = {
            **message["payload"],
            "body": message["payload"]["body"][:2000],
        }
    await available_sources(result["messages"], db)
    unread = (
        await db.execute(
            select(WBMessage.account_id, func.count())
            .where(
                WBMessage.user_id == user.id,
                ~WBMessage.is_read,
                WBMessage.expires_at > now(),
                WBMessage.received_at >= lower,
                WBMessage.received_at <= upper,
            )
            .group_by(WBMessage.account_id)
        )
    ).all()
    result["unread"] = {str(ident): count for ident, count in unread}
    result["counts"] = {}
    counts = (
        await db.execute(
            select(WBJob.automation_id, WBJob.status, func.count())
            .where(
                WBJob.user_id == user.id,
                (WBJob.expires_at > now()) | WBJob.status.in_(["queued", "running"]),
            )
            .group_by(WBJob.automation_id, WBJob.status)
        )
    ).all()
    for ident, status, count in counts:
        result["counts"].setdefault(str(ident), {})[status] = count
    return result


@router.post("/check-updates")
async def check_updates(user: AnyUser, db: AsyncSession = Depends(get_db)):
    await service.initialize(db, user.id)
    if not await db.scalar(
        select(WBMailbox.id).where(WBMailbox.user_id == user.id).limit(1)
    ):
        raise HTTPException(422, "请先登录邮箱，再检查更新")
    result = await enqueue_manual(db, user.id)
    await db.commit()
    return result


@router.put("/schedule")
async def schedule(body: Schedule, user: AnyUser, db: AsyncSession = Depends(get_db)):
    await service.initialize(db, user.id)
    pref = await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user.id).with_for_update()
    )
    pref.schedule = {**body.model_dump(), "_configured": True}
    pref.next_run_at = next_slot(pref.schedule, now(), inclusive=True)
    await db.commit()
    return {"next_run_at": pref.next_run_at}


@router.get("/automations/{ident}/jobs")
async def automation_jobs(
    ident: UUID,
    user: AnyUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    await service.owned(db, WBAutomation, ident, user.id)
    query = select(WBJob).where(
        WBJob.user_id == user.id,
        WBJob.automation_id == ident,
        (WBJob.expires_at > now()) | WBJob.status.in_(["queued", "running"]),
    )
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await db.scalars(
            query.order_by(WBJob.queued_at.desc(), WBJob.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = []
    for row in rows:
        job = service.public(row)
        snapshot = job["snapshot"]
        job["snapshot"] = {
            **snapshot,
            "payload": {**snapshot["payload"], "body": ""},
            "note": "",
            "summary": snapshot.get("summary", "")[:5000],
        }
        items.append(job)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/accounts", status_code=201)
async def add_account(body: Account, user: AnyUser, db: AsyncSession = Depends(get_db)):
    await validate_binding(db, body, user.id)
    await service.initialize(db, user.id)
    await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user.id).with_for_update()
    )
    if not body.password or not body.password.get_secret_value():
        raise HTTPException(422, "请填写密码或访问令牌")
    await check_configuration_limit(db, WBAccount, user.id)
    row = WBAccount(
        user_id=user.id,
        **body.model_dump(exclude={"password"}),
        password_encrypted=encrypt_credential(
            body.password.get_secret_value(), "platform"
        ),
    )
    validate_source_url(row.base_url)
    position = await db.scalar(
        select(func.max(WBAccount.position)).where(WBAccount.user_id == user.id)
    )
    row.position = (position if position is not None else -1) + 1
    db.add(row)
    await db.commit()
    return service.public(row)


@router.put("/accounts/{ident}")
async def edit_account(
    ident: UUID, body: Account, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await validate_binding(db, body, user.id)
    row = await service.owned(db, WBAccount, ident, user.id, True)
    for key, value in body.model_dump(exclude={"password"}).items():
        setattr(row, key, value)
    validate_source_url(row.base_url)
    if body.password and body.password.get_secret_value():
        row.password_encrypted = encrypt_credential(
            body.password.get_secret_value(), "platform"
        )
    await db.commit()
    return service.public(row)


@router.post("/automations", status_code=201)
async def add_automation(
    body: Automation, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await service.initialize(db, user.id)
    await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user.id).with_for_update()
    )
    await check_configuration_limit(db, WBAutomation, user.id)
    position = await db.scalar(
        select(func.max(WBAutomation.position)).where(WBAutomation.user_id == user.id)
    )
    row = WBAutomation(
        user_id=user.id,
        name=body.name,
        kind="custom",
        steps=[s.model_dump(mode="json") for s in body.steps],
        position=(position if position is not None else -1) + 1,
    )
    db.add(row)
    await db.commit()
    return service.public(row)


@router.put("/automations/{ident}")
async def edit_automation(
    ident: UUID, body: Automation, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    row = await service.owned(db, WBAutomation, ident, user.id, True)
    if row.kind == "tapd":
        raise HTTPException(409, "TAPD 缺陷提交功能尚未开放")
    row.name, row.steps = body.name, [s.model_dump(mode="json") for s in body.steps]
    await db.commit()
    return service.public(row)


@router.delete("/accounts/{ident}")
async def delete_account(
    ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user.id).with_for_update()
    )
    row = await service.owned(db, WBAccount, ident, user.id, True)
    row.deleted_at, row.enabled = now(), False
    await db.commit()
    return {"ok": True}


@router.delete("/automations/{ident}")
async def delete_automation(
    ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user.id).with_for_update()
    )
    row = await service.owned(db, WBAutomation, ident, user.id, True)
    row.deleted_at = now()
    await db.commit()
    return {"ok": True}


@router.put("/order/{kind}")
async def order(
    kind: str, body: Reorder, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    model = {"accounts": WBAccount, "automations": WBAutomation}.get(kind)
    if not model:
        raise HTTPException(404, "排序类型不存在")
    await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user.id).with_for_update()
    )
    rows = list(
        (
            await db.scalars(
                select(model)
                .where(model.user_id == user.id, model.deleted_at.is_(None))
                .with_for_update()
            )
        ).all()
    )
    if len(body.ids) != len(set(body.ids)) or set(body.ids) != {r.id for r in rows}:
        raise HTTPException(409, "列表已发生变化，请刷新后重新排序")
    positions = {ident: i for i, ident in enumerate(body.ids)}
    for row in rows:
        row.position = positions[row.id]
    await db.commit()
    return {"ok": True}


@router.post("/messages/{ident}/read")
async def read_message(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, WBMessage, ident, user.id, True)
    if row.expires_at <= now():
        raise HTTPException(410, "消息已过期")
    row.is_read = True
    await db.commit()
    return await message_detail(row, db)


@router.get("/messages/{ident}")
async def get_message(
    ident: UUID,
    user: AnyUser,
    jobs_page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
):
    row = await service.owned(db, WBMessage, ident, user.id)
    if row.expires_at <= now():
        raise HTTPException(410, "消息已过期")
    return await message_detail(row, db, jobs_page)


async def message_detail(row, db, jobs_page=1):
    result = service.public(row)
    await available_sources([result], db)
    account = await db.get(WBAccount, row.account_id)
    mails = (
        await db.execute(
            select(WBMail.id, WBMail.subject, WBMail.received_at)
            .join(WBMessageMail, WBMessageMail.mail_id == WBMail.id)
            .where(
                WBMessageMail.message_id == row.id,
                WBMail.expires_at > now(),
                WBMail.id.in_(
                    select(WBMailLocation.mail_id).where(
                        WBMailLocation.folder_id == account.mail_folder_id
                    )
                ),
            )
            .order_by(WBMail.received_at.desc())
        )
    ).all()
    result["mails"] = [
        {"id": str(mail.id), "subject": mail.subject, "received_at": mail.received_at}
        for mail in mails
    ]
    jobs = select(WBJob).where(
        WBJob.message_id == row.id,
        (WBJob.expires_at > now()) | WBJob.status.in_(["queued", "running"]),
    )
    result["jobs_total"] = await db.scalar(
        select(func.count()).select_from(jobs.subquery())
    )
    jobs_page = min(jobs_page, max(1, (result["jobs_total"] + 9) // 10))
    result["jobs_page"] = jobs_page
    result["jobs"] = [
        service.public(job)
        for job in (
            await db.scalars(
                jobs.order_by(WBJob.queued_at.desc(), WBJob.id.desc())
                .offset((jobs_page - 1) * 10)
                .limit(10)
            )
        ).all()
    ]
    for job in result["jobs"]:
        job["snapshot"] = {
            **job["snapshot"],
            "payload": {**job["snapshot"]["payload"], "body": ""},
            "note": "",
        }
    return result


async def available_sources(messages, db):
    candidates = [
        m
        for m in messages
        if (m.get("resource_source") or {}).get("kind") == "email"
        and m["resource_source"].get("mail_id")
    ]
    if not candidates:
        return
    valid = set(
        (
            await db.execute(
                select(WBMail.id, WBAccount.id)
                .join(WBMailLocation, WBMailLocation.mail_id == WBMail.id)
                .join(WBAccount, WBAccount.mail_folder_id == WBMailLocation.folder_id)
                .where(
                    WBMail.id.in_(
                        [UUID(m["resource_source"]["mail_id"]) for m in candidates]
                    ),
                    WBMail.expires_at > now(),
                    WBAccount.id.in_([m["account_id"] for m in candidates]),
                )
            )
        ).all()
    )
    for message in candidates:
        source = message["resource_source"]
        if (UUID(source["mail_id"]), message["account_id"]) not in valid:
            message["resource_source"] = {**source, "mail_id": None}


async def check_configuration_limit(db, model, user_id):
    count = await db.scalar(
        select(func.count())
        .select_from(model)
        .where(model.user_id == user_id, model.deleted_at.is_(None))
    )
    if count >= MAX_CONFIGURATIONS:
        raise HTTPException(
            422, f"最多保留 {MAX_CONFIGURATIONS} 个有效配置，请先删除不用的配置"
        )


async def bound_steps(db, automation, project_id):
    try:
        steps = [
            s.model_dump(mode="json")
            for s in Automation(name=automation.name, steps=automation.steps).steps
        ]
    except ValidationError:
        raise HTTPException(422, "请先完善自动化步骤") from None
    if any(s["type"] == "ticket" for s in steps):
        project = await db.get(Project, project_id) if project_id else None
        if not project or project.deleted_at:
            raise HTTPException(422, "托管信息的所属项目不存在，请检查托管平台设置")
        for step in steps:
            if step["type"] == "ticket":
                step["project_id"] = str(project.id)
    return steps


@router.post("/messages/{ident}/dismiss")
async def dismiss_message(
    ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    row = await service.owned(db, WBMessage, ident, user.id, True)
    if row.expires_at <= now():
        raise HTTPException(409, "消息已提交或过期，请刷新工作台")
    row.dismissed, row.is_read = True, True
    await db.commit()
    return {"ok": True}


@router.put("/messages/{ident}/note")
async def note(
    ident: UUID, body: Note, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    row = await service.owned(db, WBMessage, ident, user.id, True)
    if row.submitted or row.dismissed or row.expires_at <= now():
        raise HTTPException(409, "消息已提交或过期，不能再修改")
    row.note = body.note
    await db.commit()
    return {"ok": True}


@router.post("/messages/{ident}/submit", status_code=201)
async def submit(
    ident: UUID, body: Submit, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    message = await service.owned(db, WBMessage, ident, user.id, True)
    if message.submitted or message.dismissed or message.expires_at <= now():
        raise HTTPException(409, "消息已入队或过期，请刷新")
    automation = await service.owned(
        db, WBAutomation, body.automation_id, user.id, True
    )
    if automation.kind == "tapd":
        raise HTTPException(409, "TAPD 缺陷提交功能尚未开放")
    account = await service.owned(db, WBAccount, message.account_id, user.id)
    if not message.project_id:
        message.project_id = account.project_id
    steps = await bound_steps(db, automation, message.project_id)
    job = WBJob(
        user_id=user.id,
        automation_id=automation.id,
        message_id=message.id,
        input_revision=message.revision,
        snapshot={
            "payload": message.payload,
            "note": message.note,
            "platform": account.platform,
            "account_name": account.name,
            "project_id": str(message.project_id) if message.project_id else None,
        },
        steps=steps,
        expires_at=message.expires_at,
    )
    db.add(job)
    message.submitted, message.is_read = True, True
    await db.commit()
    return service.public(job)


@router.post("/jobs/{ident}/retry")
async def retry(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    job = await service.owned(db, WBJob, ident, user.id)
    if job.status != "failed" or job.expires_at <= now():
        raise HTTPException(409, "仅可重试保留期内的失败任务")
    # Match collection's message -> job lock order to avoid a retry/update deadlock.
    message = (
        await service.owned(db, WBMessage, job.message_id, user.id, True)
        if job.message_id
        else None
    )
    await db.refresh(job, with_for_update=True)
    if job.status != "failed" or job.expires_at <= now():
        raise HTTPException(409, "仅可重试保留期内的失败任务")
    if message:
        active = await db.scalar(
            select(WBJob.id)
            .where(
                WBJob.message_id == message.id, WBJob.status.in_(["queued", "running"])
            )
            .limit(1)
        )
        if active:
            raise HTTPException(409, "该信息已有自动化任务正在执行")
        if message.dismissed:
            raise HTTPException(409, "请先将已忽略信息恢复到待处理")
        message.submitted, message.is_read = True, True
    automation = await service.owned(db, WBAutomation, job.automation_id, user.id)
    project_id = (
        job.snapshot.get("project_id")
        or next((s.get("project_id") for s in job.steps if s["type"] == "ticket"), None)
        or (message.project_id if message else None)
    )
    current = await bound_steps(db, automation, project_id)
    # Completed operations remain checkpointed. Editing their prefix would invalidate side effects.
    if current[: job.step_index] != job.steps[: job.step_index]:
        raise HTTPException(409, "已完成步骤已被修改，请保留原步骤前缀后重试")
    job.steps = current
    job.status, job.error, job.queued_at = "queued", None, now()
    job.logs = [
        *job.logs[-(MAX_JOB_LOG_ENTRIES - 1) :],
        {"at": now().isoformat(), "message": "手动重试，已进入队尾"},
    ]
    await db.commit()
    return service.public(job)


async def validate_binding(db, body, user_id):
    if not body.project_id or not body.mail_folder_id:
        raise HTTPException(
            422, "请选择所属项目、网站平台和链接邮件文件夹；邮箱请通过顶部邮箱入口配置"
        )
    project = await db.get(Project, body.project_id)
    if not project or project.deleted_at:
        raise HTTPException(422, "所属项目不存在")
    await owned_folder(db, body.mail_folder_id, user_id)


@router.post("/messages/{ident}/restore")
async def restore(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, WBMessage, ident, user.id, True)
    if row.expires_at <= now():
        raise HTTPException(410, "消息已过期")
    active = await db.scalar(
        select(WBJob.id)
        .where(WBJob.message_id == row.id, WBJob.status.in_(["queued", "running"]))
        .limit(1)
    )
    row.dismissed, row.submitted = False, bool(active)
    row.is_read = bool(active)
    await db.commit()
    return {"ok": True}
