from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import ValidationError
from sqlalchemy import select, func, or_, cast, String, text
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.middleware.rbac import AnyUser, DevOnly
from app.models.user import User
from app.models.catalog import Customer, Product, Project
from app.models.ticket import Ticket
from app.services.catalog_references import require_active
from app.schemas.catalog import CustomerInput, ProductInput, ProjectInput
from app.services.catalog_locations import locations, resolve_location

router = APIRouter()
Kind = Literal['customers', 'products', 'projects']
MODELS = {'customers': Customer, 'products': Product, 'projects': Project}
SCHEMAS = {'customers': CustomerInput, 'products': ProductInput, 'projects': ProjectInput}


@router.get('/locations/countries')
async def countries(current_user: AnyUser):
    data, _ = locations()
    return sorted([{'value': key, 'label': value['name']} for key, value in data.items()], key=lambda x: x['label'])


@router.get('/locations/cities')
async def cities(current_user: AnyUser, country: str = Query(min_length=2, max_length=2), q: str = Query('', max_length=100)):
    _, data = locations()
    rows = [c for c in data.values() if c['countrycode'] == country]
    if q.strip():
        needle = q.strip().casefold()
        rows = [c for c in rows if any(needle in n.casefold() for n in [c['name'], *c.get('alternatenames', [])])]
    rows.sort(key=lambda c: (-c['population'], c['name']))
    return [{'value': str(c['geonameid']), 'label': c['name'], 'region': c.get('admin1code', '')} for c in rows[:100]]


@router.get('/suggestions/{field}')
async def suggestions(field: Literal['model', 'chipset', 'system'], current_user: AnyUser, q: str = Query('', max_length=200), db: AsyncSession = Depends(get_db)):
    col = getattr(Product, field)
    stmt = select(col).distinct().where(Product.deleted_at.is_(None), col.icontains(q.strip(), autoescape=True)).order_by(col).limit(30)
    return list((await db.scalars(stmt)).all())


def query_for(kind):
    model = MODELS[kind]
    creator, updater, deleter = aliased(User), aliased(User), aliased(User)
    if kind == 'customers':
        display = Customer.country_name + '-' + Customer.city_name + '-' + Customer.company_name
        searchable = [display, Customer.company_name, Customer.country_name, Customer.country_code, Customer.city_name, Customer.level, Customer.notes, cast(Customer.contacts, String)]
        filters = {'level': Customer.level, 'country_code': Customer.country_code, 'city_name': Customer.city_name}
        sortable = {'name': display, 'company_name': Customer.company_name, 'level': Customer.level}
    elif kind == 'products':
        display = Product.type + '-' + Product.model
        searchable = [display, Product.type, Product.model, Product.chipset, Product.system, Product.repository_url, Product.notes]
        filters = {'type': Product.type, 'chipset': Product.chipset, 'system': Product.system}
        sortable = {'name': display, 'model': Product.model, 'type': Product.type}
    else:
        display = Customer.country_name + '-' + Customer.company_name + '-' + Product.model + '-' + Project.number
        searchable = [display, Project.number, Project.pm, Project.stage, Project.start_month, Customer.company_name, Customer.country_name, Product.model]
        filters = {'stage': Project.stage, 'pm': Project.pm, 'customer_id': Project.customer_id, 'product_id': Project.product_id}
        sortable = {'name': display, 'number': Project.number, 'start_month': Project.start_month, 'stage': Project.stage}
    stmt = select(model, display.label('display_name'), creator.name.label('created_by_name'), updater.name.label('updated_by_name'))
    stmt = stmt.join(creator, model.created_by == creator.id).join(updater, model.updated_by == updater.id)
    stmt = stmt.outerjoin(deleter, model.deleted_by == deleter.id).add_columns(deleter.name.label('deleted_by_name'))
    if kind == 'projects':
        stmt = stmt.join(Customer, Project.customer_id == Customer.id).join(Product, Project.product_id == Product.id)
        stmt = stmt.add_columns((Customer.country_name + '-' + Customer.city_name + '-' + Customer.company_name).label('customer_name'), (Product.type + '-' + Product.model).label('product_name'))
    sortable.update({'created_at': model.created_at, 'updated_at': model.updated_at, 'deleted_at': model.deleted_at})
    return stmt, searchable, filters, sortable


def serialize(row):
    entity = row[0]
    result = {col.name: getattr(entity, col.name) for col in entity.__table__.columns}
    result.update({key: value for key, value in row._mapping.items() if key not in ('Customer', 'Product', 'Project')})
    return result


@router.get('/{kind}')
async def list_records(kind: Kind, current_user: AnyUser, q: str = Query('', max_length=200),
                       filter_field: str = '', filter_value: str = Query('', max_length=200),
                       sort: str = 'updated_at', direction: Literal['asc', 'desc'] = 'desc',
                       page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                       trash: bool = False,
                       db: AsyncSession = Depends(get_db)):
    stmt, searchable, filters, sortable = query_for(kind)
    stmt = stmt.where(MODELS[kind].deleted_at.is_not(None) if trash else MODELS[kind].deleted_at.is_(None))
    if sort not in sortable or (filter_field and filter_field not in filters):
        raise HTTPException(422, '不支持的筛选或排序字段')
    if q.strip():
        stmt = stmt.where(or_(*(col.icontains(q.strip(), autoescape=True) for col in searchable)))
    if filter_field and filter_value:
        stmt = stmt.where(cast(filters[filter_field], String) == filter_value)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    order = sortable[sort]
    stmt = stmt.order_by(order.asc() if direction == 'asc' else order.desc(), MODELS[kind].id).offset((page - 1) * page_size).limit(page_size)
    return {'items': [serialize(row) for row in (await db.execute(stmt)).all()], 'total': total}


@router.get('/{kind}/{record_id}')
async def get_record(kind: Kind, record_id: UUID, current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    stmt, *_ = query_for(kind)
    row = (await db.execute(stmt.where(MODELS[kind].id == record_id))).first()
    if not row:
        raise HTTPException(404, '记录不存在')
    return serialize(row)


async def validate_data(kind, data, db):
    try:
        parsed = SCHEMAS[kind].model_validate(data)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_context=False))
    values = parsed.model_dump()
    if kind == 'customers':
        location = resolve_location(values['country_code'], values['city_id'])
        if not location:
            raise HTTPException(422, '请选择有效的国家和对应城市')
        values.update(location)
    elif kind == 'projects':
        await require_active(db, Customer, values['customer_id'], '客户')
        await require_active(db, Product, values['product_id'], '产品')
    return values


@router.post('/{kind}', status_code=201)
async def create_record(kind: Kind, current_user: AnyUser, body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    values = await validate_data(kind, body, db)
    record = MODELS[kind](**values, created_by=current_user.id, updated_by=current_user.id)
    db.add(record)
    await db.commit()
    return await get_record(kind, record.id, current_user, db)


@router.put('/{kind}/{record_id}')
async def update_record(kind: Kind, record_id: UUID, current_user: AnyUser, body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    revision = body.pop('revision', None)
    if type(revision) is not int or revision < 1:
        raise HTTPException(422, '缺少有效的数据版本号')
    record = await db.scalar(select(MODELS[kind]).where(MODELS[kind].id == record_id).with_for_update())
    if not record:
        raise HTTPException(404, '记录不存在')
    if record.revision != revision:
        raise HTTPException(409, '其他成员已更新此记录，请关闭并重新打开后编辑')
    if record.deleted_at is not None:
        raise HTTPException(409, '此记录已移至最近删除，请先恢复后再编辑')
    values = await validate_data(kind, body, db)
    for key, value in values.items():
        setattr(record, key, value)
    record.updated_by = current_user.id
    record.updated_at = datetime.now(timezone.utc)
    record.revision += 1
    await db.commit()
    return await get_record(kind, record.id, current_user, db)


async def assert_unreferenced(kind, record_id, db):
    if kind == 'customers':
        query = select(Project.id).where(Project.customer_id == record_id)
        message = '客户仍被项目引用（包含最近删除中的项目），无法删除；请先解除引用'
    elif kind == 'products':
        query = select(Project.id).where(Project.product_id == record_id)
        message = '产品仍被项目引用（包含最近删除中的项目），无法删除；请先解除引用'
    else:
        query = select(Ticket.id).where(Ticket.project_id == record_id)
        message = '项目仍被工单引用，无法删除；请先解除引用'
    if await db.scalar(query.limit(1)):
        raise HTTPException(409, message)


def audit_change(record, user):
    record.updated_by = user.id
    record.updated_at = datetime.now(timezone.utc)
    record.revision += 1


@router.delete('/{kind}/trash')
async def empty_trash(kind: Kind, current_user: DevOnly, db: AsyncSession = Depends(get_db)):
    model = MODELS[kind]
    records = list((await db.scalars(select(model).where(model.deleted_at.is_not(None))
                                   .order_by(model.id).with_for_update().execution_options(populate_existing=True))).all())
    # Validate the complete batch before deleting anything.
    for record in records:
        await assert_unreferenced(kind, record.id, db)
    for record in records:
        if kind == 'projects':
            await db.execute(text('DELETE FROM ticket_project_counters WHERE project_id = :id'), {'id': record.id})
        await db.delete(record)
    await db.commit()
    return {'deleted_count': len(records)}


async def lock_revision(kind, record_id, revision, db):
    record = await db.scalar(select(MODELS[kind]).where(MODELS[kind].id == record_id)
                             .with_for_update().execution_options(populate_existing=True))
    if not record:
        raise HTTPException(404, '记录不存在')
    if record.revision != revision:
        raise HTTPException(409, '其他成员已更新此记录，请刷新后重试')
    return record


@router.delete('/{kind}/{record_id}')
async def move_to_trash(kind: Kind, record_id: UUID, current_user: AnyUser,
                        revision: int = Query(ge=1), db: AsyncSession = Depends(get_db)):
    record = await lock_revision(kind, record_id, revision, db)
    if record.deleted_at is not None:
        raise HTTPException(409, '记录已在最近删除中')
    await assert_unreferenced(kind, record.id, db)
    record.deleted_at = datetime.now(timezone.utc)
    record.deleted_by = current_user.id
    audit_change(record, current_user)
    await db.commit()
    return {'message': '已移至最近删除，可在清空前恢复'}


@router.post('/{kind}/{record_id}/restore')
async def restore_record(kind: Kind, record_id: UUID, current_user: AnyUser,
                         revision: int = Query(ge=1), db: AsyncSession = Depends(get_db)):
    record = await lock_revision(kind, record_id, revision, db)
    if record.deleted_at is None:
        raise HTTPException(409, '记录未被删除，请刷新列表')
    if kind == 'projects':
        await require_active(db, Customer, record.customer_id, '客户')
        await require_active(db, Product, record.product_id, '产品')
    record.deleted_at = None
    record.deleted_by = None
    audit_change(record, current_user)
    await db.commit()
    return await get_record(kind, record.id, current_user, db)
