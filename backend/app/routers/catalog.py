from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import ValidationError
from sqlalchemy import select, func, or_, cast, String, text
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from app.database import get_db
from app.middleware.rbac import AnyUser, DevOnly
from app.models.user import User, UserRole
from app.models.catalog import Customer, Product, Project, CatalogOption
from app.models.ticket import Ticket
from app.services.duplicate_names import first_available_name
from app.services.catalog_references import require_active
from app.schemas.catalog import CustomerInput, ProductInput, ProjectInput, CatalogOptionInput
from app.services.catalog_locations import locations, resolve_location

router = APIRouter()
Kind = Literal['customers', 'products', 'projects']
MODELS = {'customers': Customer, 'products': Product, 'projects': Project}
SCHEMAS = {'customers': CustomerInput, 'products': ProductInput, 'projects': ProjectInput}
OptionCategory = Literal['customer_level', 'product_type', 'project_pm', 'project_stage', 'contact_method']
OPTION_COLUMNS = {'customer_level': Customer.level, 'product_type': Product.type,
                  'project_pm': Project.pm, 'project_stage': Project.stage}


@router.get('/options/{category}')
async def list_options(category: OptionCategory, current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    values = await db.scalars(select(CatalogOption.value).where(CatalogOption.category == category).order_by(CatalogOption.value))
    return [{'value': value, 'label': value} for value in values]


@router.post('/options/{category}', status_code=201)
async def add_option(category: OptionCategory, current_user: DevOnly, body: CatalogOptionInput, db: AsyncSession = Depends(get_db)):
    created = await db.scalar(insert(CatalogOption).values(category=category, value=body.value)
                              .on_conflict_do_nothing().returning(CatalogOption.value))
    if created is None:
        raise HTTPException(409, '此选项已存在')
    await db.commit()
    return {'value': created, 'label': created}


@router.delete('/options/{category}')
async def delete_option(category: OptionCategory, current_user: DevOnly, value: str = Query(min_length=1, max_length=100), db: AsyncSession = Depends(get_db)):
    option = await db.scalar(select(CatalogOption).where(CatalogOption.category == category, CatalogOption.value == value).with_for_update())
    if option is None:
        raise HTTPException(404, '选项不存在，请刷新列表')
    # Include trash. The same option row is share-locked during record writes.
    if category == 'contact_method':
        references = select(Customer.id).where(Customer.contacts.contains([{'methods': [{'type': value}]}]))
    else:
        column = OPTION_COLUMNS[category]
        references = select(column).where(column == value)
    if await db.scalar(references.limit(1)) is not None:
        raise HTTPException(409, '仍有记录使用此选项（包括最近删除中的记录），无法删除')
    await db.delete(option)
    await db.commit()
    return {'message': '选项已删除'}


@router.get('/locations/countries')
async def countries(current_user: AnyUser):
    return sorted([{'value': key, 'label': value['name']} for key, value in locations().items()], key=lambda x: x['label'])


@router.get('/business-options')
async def business_options(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Customer.business).where(Customer.deleted_at.is_(None)))
    return sorted({name for names in rows for name in names}, key=str.casefold)


@router.get('/fae-options')
async def fae_options(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(User.id, User.name).where(User.role == UserRole.engineer, User.is_active.is_(True)).order_by(User.name, User.id))
    return [{'value': str(row.id), 'label': row.name} for row in rows]


@router.get('/suggestions/{field}')
async def suggestions(field: Literal['model', 'chipset', 'system'], current_user: AnyUser, q: str = Query('', max_length=200), db: AsyncSession = Depends(get_db)):
    col = getattr(Product, field)
    stmt = select(col).distinct().where(Product.deleted_at.is_(None), col.icontains(q.strip(), autoescape=True)).order_by(col).limit(30)
    return list((await db.scalars(stmt)).all())


def query_for(kind):
    model = MODELS[kind]
    creator, updater, deleter = aliased(User), aliased(User), aliased(User)
    if kind == 'customers':
        display = Customer.identification_name
        searchable = [display, Customer.company_name, Customer.country_name, Customer.country_code, cast(Customer.business, String), Customer.level, Customer.notes, cast(Customer.contacts, String)]
        filters = {'level': Customer.level, 'country_code': Customer.country_code}
        sortable = {'name': display, 'company_name': Customer.company_name, 'level': Customer.level, 'country_name': Customer.country_name, 'business': cast(Customer.business, String)}
    elif kind == 'products':
        display = Product.identification_name
        searchable = [display, Product.type, Product.model, Product.chipset, Product.system, Product.repository_url, Product.fingerprint, Product.notes]
        filters = {'type': Product.type, 'chipset': Product.chipset, 'system': Product.system}
        sortable = {'name': display, 'model': Product.model, 'type': Product.type, 'chipset': Product.chipset, 'system': Product.system}
    else:
        fae = aliased(User)
        display = Customer.country_name + '-' + Customer.company_name + '-' + Product.model + '-' + Project.number
        searchable = [display, Project.number, Project.pm, fae.name, Project.stage, cast(Project.start_date, String), Customer.company_name, Customer.country_name, Product.model]
        filters = {'stage': Project.stage, 'pm': Project.pm, 'customer_id': Project.customer_id, 'product_id': Project.product_id}
        sortable = {'name': display, 'number': Project.number, 'start_date': Project.start_date, 'stage': Project.stage, 'pm': Project.pm, 'fae_name': fae.name}
    stmt = select(model, display.label('display_name'), creator.name.label('created_by_name'), updater.name.label('updated_by_name'))
    stmt = stmt.join(creator, model.created_by == creator.id).join(updater, model.updated_by == updater.id)
    stmt = stmt.outerjoin(deleter, model.deleted_by == deleter.id).add_columns(deleter.name.label('deleted_by_name'))
    if kind == 'projects':
        stmt = stmt.outerjoin(fae, Project.fae_id == fae.id).add_columns(fae.name.label('fae_name'))
        stmt = stmt.join(Customer, Project.customer_id == Customer.id).join(Product, Project.product_id == Product.id)
        stmt = stmt.add_columns(Customer.identification_name.label('customer_name'), Product.identification_name.label('product_name'))
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
                       page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100),
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
    categories = {'customers': [('customer_level', 'level')], 'products': [('product_type', 'type')],
                  'projects': [('project_pm', 'pm'), ('project_stage', 'stage')]}
    for category, field in categories[kind]:
        option = await db.scalar(select(CatalogOption).where(CatalogOption.category == category, CatalogOption.value == values[field]).with_for_update(read=True))
        if option is None:
            raise HTTPException(422, f'请选择已维护的选项：{field}')
    if kind == 'customers':
        for tool in sorted({method['type'] for contact in values['contacts'] for method in contact['methods']}):
            option = await db.scalar(select(CatalogOption).where(CatalogOption.category == 'contact_method', CatalogOption.value == tool).with_for_update(read=True))
            if option is None:
                raise HTTPException(422, '请选择已维护的联系方式工具')
        location = resolve_location(values['country_code'])
        if not location:
            raise HTTPException(422, '请选择有效的国家 / 地区')
        values.update(location)
        values['business'] = list(dict.fromkeys(values['business']))
    elif kind == 'projects':
        await require_active(db, Customer, values['customer_id'], '客户')
        await require_active(db, Product, values['product_id'], '产品')
        if values['fae_id'] is not None:
            fae = await db.scalar(select(User).where(User.id == values['fae_id'], User.role == UserRole.engineer, User.is_active.is_(True)))
            if not fae:
                raise HTTPException(422, 'FAE 必须选择已注册且启用的工程师账号')
    return values


async def lock_record_names(db, kind):
    # Acquire before record/option locks in every named-record write path.
    # One lock covers literal suffix collisions across different base names.
    if kind in ('customers', 'products'):
        await db.execute(text('SELECT pg_advisory_xact_lock(73130913)'))


async def allocate_record_name(db, kind, values):
    model = MODELS[kind]
    base = (values['country_name'] + '-' + values['company_name'] if kind == 'customers'
            else values['type'] + '-' + values['model'])
    occupied = await db.scalars(select(model.identification_name).where(
        model.identification_name.startswith(base, autoescape=True)))
    # Trash intentionally occupies names; historical/permanently deleted rows do not.
    return first_available_name(base, occupied.all())


@router.post('/{kind}', status_code=201)
async def create_record(kind: Kind, current_user: AnyUser, body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    await lock_record_names(db, kind)
    values = await validate_data(kind, body, db)
    if kind in ('customers', 'products'):
        values['identification_name'] = await allocate_record_name(db, kind, values)
    record = MODELS[kind](**values, created_by=current_user.id, updated_by=current_user.id)
    db.add(record)
    await db.commit()
    return await get_record(kind, record.id, current_user, db)


@router.put('/{kind}/{record_id}')
async def update_record(kind: Kind, record_id: UUID, current_user: AnyUser, body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    await lock_record_names(db, kind)
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
    name_changed = ((kind == 'customers' and (record.company_name != values['company_name'] or record.country_code != values['country_code']))
                    or (kind == 'products' and (record.type != values['type'] or record.model != values['model'])))
    if name_changed:
        values['identification_name'] = await allocate_record_name(db, kind, values)
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
    await lock_record_names(db, kind)
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
