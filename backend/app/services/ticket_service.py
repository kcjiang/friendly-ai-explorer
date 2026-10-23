from app.i18n import message as system_message
from datetime import datetime, timezone
from sqlalchemy import select, text, func, or_, case, cast, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException
from app.models.ticket import Ticket, TicketComment, TicketStatus
from app.models.catalog import Project, Customer, Product
from app.models.user import User, UserRole
from app.schemas.ticket import CreateTicketRequest, UpdateTicketRequest, AddCommentRequest
from app.services.catalog_references import require_active


def can_edit(ticket, user):
    return user.role in (UserRole.developer, UserRole.leader) or user.id in (ticket.updated_by, ticket.assignee_id)


def require_edit(ticket, user):
    if not can_edit(ticket, user):
        raise HTTPException(403, system_message("errors.onlyDevelopersLeadersTheLastEditorOrTheAssigneeCanEditThis"))


def stamp(ticket, user):
    ticket.updated_by = user.id
    ticket.updated_at = datetime.now(timezone.utc)
    ticket.revision += 1


async def next_project_number(db, project_id):
    return await db.scalar(text('''INSERT INTO ticket_project_counters(project_id, last_value) VALUES (:id, 1)
        ON CONFLICT (project_id) DO UPDATE SET last_value = ticket_project_counters.last_value + 1
        RETURNING last_value'''), {'id': project_id})


def ticket_query(details=False):
    q = select(Ticket).options(selectinload(Ticket.creator), selectinload(Ticket.assignee), selectinload(Ticket.updater))
    if details:
        q = q.options(selectinload(Ticket.comments).selectinload(TicketComment.author))
    return q.execution_options(populate_existing=True)


async def decorate(tickets, db, user):
    ids = {t.project_id for t in tickets if t.project_id}
    projects = {}
    if ids:
        rows = (await db.execute(select(Project, Customer, Product).join(Customer, Project.customer_id == Customer.id).join(Product, Project.product_id == Product.id).where(Project.id.in_(ids)))).all()
        projects = {p.id: (p, c, product) for p, c, product in rows}
    for t in tickets:
        t.can_edit = can_edit(t, user)
        t.project_name = '历史工单 · 待关联项目'
        customer, product = t.customer_name or '未关联客户', t.product_name or '未关联产品'
        if t.project_id in projects:
            p, c, prod = projects[t.project_id]
            customer, product = c.company_name, prod.model
            t.project_name = f'{c.country_name}-{c.company_name}-{prod.model}-{p.number}'
        # These display values must not accidentally write into the stored legacy fields.
        source_reference = t.source_number or (f'{t.source}{t.project_seq}' if t.project_seq else '待关联')
        t.display_name = f'{customer}-{source_reference}-{product}-{t.ticket_no}'
        t.current_customer_name, t.current_product_name = customer, product
        t.project_summary = f'{customer}-{product}'
    return tickets


async def get_tickets(db, user, mine=False, q='', status=None, priority=None, project_id=None, source='', sort='updated_at', direction='desc', assignee_id=None, state='all', created_from=None, created_before=None):
    query = ticket_query().outerjoin(Project, Ticket.project_id == Project.id).outerjoin(Customer, Project.customer_id == Customer.id).outerjoin(Product, Project.product_id == Product.id)
    if created_from and created_before and created_from >= created_before:
        raise HTTPException(422, system_message("errors.startTimeMustBeBeforeEndTime"))
    if created_from:
        query = query.where(Ticket.created_at >= created_from)
    if created_before:
        query = query.where(Ticket.created_at < created_before)
    if mine:
        query = query.where(Ticket.assignee_id == user.id)
    elif assignee_id:
        query = query.where(Ticket.assignee_id == assignee_id)
    if state == 'open':
        query = query.where(Ticket.status != TicketStatus.resolved)
    elif state == 'closed':
        query = query.where(Ticket.status == TicketStatus.resolved)
    if q.strip():
        reference = func.coalesce(func.nullif(Ticket.source_number, ''), Ticket.source + cast(Ticket.project_seq, String), '待关联')
        display = func.coalesce(Customer.company_name, Ticket.customer_name, '未关联客户') + '-' + reference + '-' + func.coalesce(Product.model, Ticket.product_name, '未关联产品') + '-' + Ticket.ticket_no
        status_label = case(*[(Ticket.status == key, label) for key, label in (
            ('open', '新工单'), ('reproducing', '待复现'), ('in_progress', '修复中'),
            ('verifying', '验证修复'), ('pending', '挂起'), ('resolved', '已解决'))])
        columns = [display, Ticket.title, Ticket.ticket_no, Ticket.source_number, Ticket.source,
                   Customer.company_name, Customer.country_name, Product.model, Project.number,
                   Ticket.description, Ticket.next_plan, Ticket.notes,
                   Ticket.status_note, cast(Ticket.priority, String), status_label]
        query = query.where(or_(*(c.icontains(q.strip(), autoescape=True) for c in columns),
                               Ticket.assignee.has(or_(User.name.icontains(q.strip(), autoescape=True),
                                                       User.email.icontains(q.strip(), autoescape=True)))))
    for field, value in ((Ticket.status, status), (Ticket.priority, priority), (Ticket.project_id, project_id), (Ticket.source, source)):
        if value:
            query = query.where(field == value)
    sorts = {'updated_at': Ticket.updated_at, 'created_at': Ticket.created_at, 'system_seq': Ticket.system_seq, 'title': Ticket.title,
             'priority': case((Ticket.priority == 'critical', 3), (Ticket.priority == 'major', 2), else_=1),
             'status': case(*[(Ticket.status == value, i) for i, value in enumerate(('open', 'reproducing', 'in_progress', 'verifying', 'pending', 'resolved'))])}
    if sort not in sorts:
        raise HTTPException(422, system_message("errors.unsupportedSortField"))
    order = sorts[sort]
    rows = list((await db.scalars(query.order_by(order.asc() if direction == 'asc' else order.desc(), Ticket.id))).all())
    return await decorate(rows, db, user)


async def locked_ticket(ticket_id, db, user, revision=None):
    ticket = await db.scalar(select(Ticket).where(Ticket.id == ticket_id).with_for_update().execution_options(populate_existing=True))
    if not ticket:
        raise HTTPException(404, system_message("errors.ticketNotFound"))
    require_edit(ticket, user)
    if revision is not None and ticket.revision != revision:
        raise HTTPException(409, system_message("errors.thisTicketWasUpdatedRefreshAndTryAgain"))
    return ticket


async def get_ticket(ticket_id, db, user):
    ticket = await db.scalar(ticket_query(True).where(Ticket.id == ticket_id))
    if not ticket:
        raise HTTPException(404, system_message("errors.ticketNotFound"))
    return (await decorate([ticket], db, user))[0]


async def validate_references(values, db):
    if 'project_id' in values:
        await require_active(db, Project, values['project_id'], '项目')
    if 'assignee_id' in values:
        assignee = await db.get(User, values['assignee_id'])
        if not assignee or not assignee.is_active:
            raise HTTPException(422, system_message("errors.selectAnActiveAccountAsTheAssignee"))


def validate_tapd(values, ticket=None):
    enabled = values.get('tapd_created', ticket.tapd_created if ticket else False)
    url = values.get('tapd_url', ticket.tapd_url if ticket else '')
    if enabled and not url:
        raise HTTPException(422, system_message("errors.enterATapdUrlWhenAnInternalTapdTicketHasBeenCreated"))
    if not enabled:
        values['tapd_url'] = ''


async def create_ticket(body: CreateTicketRequest, db: AsyncSession, user: User, commit=True):
    values = body.model_dump()
    values['assignee_id'] = values['assignee_id'] or user.id
    await validate_references(values, db)
    validate_tapd(values)
    system_seq = await db.scalar(text("SELECT nextval('ticket_seq')"))
    project_seq = await next_project_number(db, values['project_id'])
    ticket = Ticket(**values, system_seq=system_seq, project_seq=project_seq, ticket_no=f'ft{system_seq}', creator_id=user.id, updated_by=user.id)
    if ticket.status == TicketStatus.resolved:
        ticket.resolved_at = datetime.now(timezone.utc)
    db.add(ticket)
    await db.flush()
    if commit:
        await db.commit()
    return await get_ticket(ticket.id, db, user)


async def update_ticket(ticket_id, body: UpdateTicketRequest, db, user):
    ticket = await locked_ticket(ticket_id, db, user, body.revision)
    values = body.model_dump(exclude_unset=True, exclude={'revision'})
    await validate_references(values, db)
    validate_tapd(values, ticket)
    if 'project_id' in values and values['project_id'] != ticket.project_id:
        ticket.project_seq = await next_project_number(db, values['project_id'])
    for key, value in values.items():
        setattr(ticket, key, value)
    ticket.resolved_at = (ticket.resolved_at or datetime.now(timezone.utc)) if ticket.status == TicketStatus.resolved else None
    stamp(ticket, user)
    await db.commit()
    return await get_ticket(ticket_id, db, user)


async def delete_ticket(ticket_id, db, user, revision):
    ticket = await locked_ticket(ticket_id, db, user, revision)
    await db.delete(ticket)
    await db.commit()
    return {'message': system_message("errors.deleteSuccess")}


async def add_comment(ticket_id, body: AddCommentRequest, db, user):
    ticket = await locked_ticket(ticket_id, db, user)
    comment = TicketComment(ticket_id=ticket.id, author_id=user.id, content=body.content, is_internal=body.is_internal)
    db.add(comment)
    stamp(ticket, user)
    await db.commit()
    return await db.scalar(select(TicketComment).options(selectinload(TicketComment.author)).where(TicketComment.id == comment.id))


async def get_stats(db, user):
    query = select(Ticket.status, func.count()).group_by(Ticket.status)
    if user.role == UserRole.engineer:
        query = query.where(Ticket.assignee_id == user.id)
    stats = {s.value: 0 for s in TicketStatus}
    for status, count in (await db.execute(query)).all():
        stats[status.value] = count
    return {'total': sum(stats.values()), **stats}
