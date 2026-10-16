from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.middleware.rbac import AnyUser
from app.models.ai_task import AITask, TaskAccount, TaskIssue, TaskRun, TaskTemplate, now
from app.schemas.ai_task import AccountBody, TaskBody, TemplateBody, ConvertBody, DraftBody, ProcessBody, DEFAULT_FIELDS
from app.services import ai_task_service as service

router = APIRouter()


def public(row):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns if c.name not in ("password_encrypted", "user_id")}


@router.get("")
async def overview(user: AnyUser, db: AsyncSession = Depends(get_db)):
    result = {}
    for name, model in [("accounts", TaskAccount), ("tasks", AITask), ("templates", TaskTemplate), ("issues", TaskIssue), ("runs", TaskRun)]:
        query = select(model).where(model.user_id == user.id)
        if model == TaskRun:
            query = query.order_by(TaskRun.started_at.desc()).limit(50)
        elif model == TaskIssue:
            query = query.order_by(TaskIssue.processed, TaskIssue.source["updated"].astext.desc().nulls_last(), TaskIssue.updated_at.desc())
        result[name] = [public(row) for row in (await db.scalars(query)).all()]
    result["default_template"] = {"name": "缺陷创建模板-FAE-10150121", "fields": DEFAULT_FIELDS}
    return result


@router.post("/accounts")
async def create_account(body: AccountBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    if not body.password or not body.password.get_secret_value():
        raise HTTPException(422, "请输入密码")
    service.check_site(body.base_url)
    row = TaskAccount(user_id=user.id, **body.model_dump(exclude={"password"}), password_encrypted=service.encrypt(body.password.get_secret_value()))
    db.add(row)
    await db.commit()
    return public(row)


@router.put("/accounts/{ident}")
async def update_account(ident: UUID, body: AccountBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, TaskAccount, ident, user.id, lock=True)
    service.check_site(body.base_url)
    for field, value in body.model_dump(exclude={"password"}).items():
        setattr(row, field, value)
    if body.password and body.password.get_secret_value():
        row.password_encrypted = service.encrypt(body.password.get_secret_value())
    await db.commit()
    return public(row)


@router.post("/accounts/{ident}/test")
async def test_account(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, TaskAccount, ident, user.id)
    async with service.JiraClient(row) as jira:
        await jira.authenticate()
    return {"message": "Jira 登录成功"}


@router.delete("/accounts/{ident}")
async def delete_account(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, TaskAccount, ident, user.id, lock=True)
    if await db.scalar(select(AITask.id).where(AITask.account_id == ident)):
        raise HTTPException(409, "请先删除使用此账户的任务")
    await db.delete(row)
    await db.commit()
    return {"message": "托管账户已删除"}


@router.post("/tasks")
async def create_task(body: TaskBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    await service.owned(db, TaskAccount, body.account_id, user.id, lock=True)
    row = AITask(user_id=user.id, **body.model_dump())
    db.add(row)
    await db.commit()
    return public(row)


@router.put("/tasks/{ident}")
async def update_task(ident: UUID, body: TaskBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, AITask, ident, user.id, lock=True)
    await service.owned(db, TaskAccount, body.account_id, user.id)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.next_run_at = now()
    await db.commit()
    return public(row)


@router.delete("/tasks/{ident}")
async def delete_task(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, AITask, ident, user.id, lock=True)
    await db.delete(row)
    await db.commit()
    return {"message": "任务已删除，已发现问题和草稿保留"}


@router.post("/tasks/{ident}/run")
async def run_task(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    await service.owned(db, AITask, ident, user.id)
    return await service.scan(ident, user.id)


@router.post("/templates")
async def create_template(body: TemplateBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = TaskTemplate(user_id=user.id, **body.model_dump())
    db.add(row)
    await db.commit()
    return public(row)


@router.put("/templates/{ident}")
async def update_template(ident: UUID, body: TemplateBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, TaskTemplate, ident, user.id, lock=True)
    row.name, row.fields = body.name, body.fields
    await db.commit()
    return public(row)


@router.delete("/templates/{ident}")
async def delete_template(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    row = await service.owned(db, TaskTemplate, ident, user.id)
    await db.delete(row)
    await db.commit()
    return {"message": "模板已删除，已有草稿保留"}


@router.post("/issues/{ident}/convert")
async def convert_issue(ident: UUID, body: ConvertBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    issue = await service.owned(db, TaskIssue, ident, user.id, lock=True)
    template = await service.owned(db, TaskTemplate, body.template_id, user.id) if body.template_id else None
    account = await db.scalar(select(TaskAccount).where(TaskAccount.user_id == user.id, TaskAccount.base_url == issue.site))
    if not account:
        raise HTTPException(422, "来源站点的托管账户已删除，请重新添加")
    result = await service.convert(issue, account, template)
    await db.commit()
    return result


@router.put("/issues/{ident}/draft")
async def save_draft(ident: UUID, body: DraftBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    issue = await service.owned(db, TaskIssue, ident, user.id, lock=True)
    if not issue.draft or set(body.fields) != set(issue.draft["fields"]):
        raise HTTPException(422, "草稿不存在或模板字段不匹配")
    if any(len(v) > 100000 for v in body.fields.values()):
        raise HTTPException(422, "字段内容过长")
    issue.draft = {**issue.draft, "fields": body.fields}
    await db.commit()
    return issue.draft


@router.patch("/issues/{ident}/processed")
async def process_issue(ident: UUID, body: ProcessBody, user: AnyUser, db: AsyncSession = Depends(get_db)):
    issue = await service.owned(db, TaskIssue, ident, user.id, lock=True)
    if body.processed and not issue.draft:
        raise HTTPException(422, "请先导入生成草稿")
    issue.processed = body.processed
    await db.commit()
    return public(issue)
