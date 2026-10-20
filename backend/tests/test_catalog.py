"""Integration tests against the local development schema; all writes roll back."""
import unittest
from uuid import uuid4
import httpx
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database import engine, get_db
from app.middleware.auth import get_current_user
from app.models.user import User, UserRole
from app.models.catalog import Customer, Product, Project, CatalogOption


class CatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_managed_options_permissions_and_trash_references(self):
        developer = User(name='Options developer', email=f'{uuid4()}@example.com', role=UserRole.developer, password_hash='test-only', is_active=True)
        engineer = User(name='Options engineer', email=f'{uuid4()}@example.com', role=UserRole.engineer, password_hash='test-only', is_active=True)
        self.db.add_all([developer, engineer])
        await self.db.flush()
        self.user = developer
        values = {category: f'{category}-{uuid4()}' for category in ('customer_level', 'product_type', 'project_pm', 'project_stage', 'contact_method')}
        for category, value in values.items():
            response = await self.client.post(f'/api/v1/catalog/options/{category}', json={'value': value})
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual((await self.client.post(f'/api/v1/catalog/options/{category}', json={'value': value})).status_code, 409)
        self.user = engineer
        for category, value in values.items():
            self.assertIn(value, [row['value'] for row in (await self.client.get(f'/api/v1/catalog/options/{category}')).json()])
            self.assertEqual((await self.client.post(f'/api/v1/catalog/options/{category}', json={'value': 'Forbidden'})).status_code, 403)
            self.assertEqual((await self.client.delete(f'/api/v1/catalog/options/{category}', params={'value': value})).status_code, 403)
        customer_body = {'company_name': f'Options-{uuid4()}', 'country_code': 'CN', 'level': values['customer_level'], 'contacts': [{'name': 'Options contact', 'methods': [{'type': values['contact_method'], 'value': 'contact@example.com'}]}]}
        customer = await self.client.post('/api/v1/catalog/customers', json=customer_body)
        self.assertEqual(customer.status_code, 201, customer.text)
        product = await self.client.post('/api/v1/catalog/products', json={'type': values['product_type'], 'model': 'Manual model', 'chipset': 'Manual chip', 'system': 'Manual OS'})
        self.assertEqual(product.status_code, 201, product.text)
        project = await self.client.post('/api/v1/catalog/projects', json={'number': 'Options project', 'pm': values['project_pm'], 'stage': values['project_stage'], 'start_date': '2026-10-20', 'customer_id': customer.json()['id'], 'product_id': product.json()['id']})
        self.assertEqual(project.status_code, 201, project.text)
        self.assertEqual((await self.client.post('/api/v1/catalog/customers', json={**customer_body, 'level': 'Not maintained'})).status_code, 422)
        self.assertEqual((await self.client.post('/api/v1/catalog/customers', json={**customer_body, 'contacts': [{'name': 'Invalid tool', 'methods': [{'type': 'Not maintained', 'value': 'x'}]}]})).status_code, 422)
        self.user = developer
        for category, value in values.items():
            self.assertEqual((await self.client.delete(f'/api/v1/catalog/options/{category}', params={'value': value})).status_code, 409)
        response = await self.client.delete('/api/v1/catalog/projects/' + project.json()['id'], params={'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        for category in ('project_pm', 'project_stage'):
            response = await self.client.delete(f'/api/v1/catalog/options/{category}', params={'value': values[category]})
            self.assertEqual(response.status_code, 409, response.text)
        await self.db.execute(delete(Project).where(Project.id == project.json()['id']))
        for kind, row in (('customers', customer), ('products', product)):
            response = await self.client.delete(f'/api/v1/catalog/{kind}/' + row.json()['id'], params={'revision': 1})
            self.assertEqual(response.status_code, 200, response.text)
        for category in ('customer_level', 'product_type', 'contact_method'):
            self.assertEqual((await self.client.delete(f'/api/v1/catalog/options/{category}', params={'value': values[category]})).status_code, 409)
        await self.db.execute(delete(Customer).where(Customer.id == customer.json()['id']))
        await self.db.execute(delete(Product).where(Product.id == product.json()['id']))
        await self.db.commit()
        for category, value in values.items():
            response = await self.client.delete(f'/api/v1/catalog/options/{category}', params={'value': value})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn(value, [row['value'] for row in (await self.client.get(f'/api/v1/catalog/options/{category}')).json()])

    async def test_project_fae_options_validation_and_updates(self):
        marker = f'FAE-{uuid4()}'
        users = []
        for role, active in ((UserRole.engineer, True), (UserRole.leader, True), (UserRole.developer, True), (UserRole.engineer, False)):
            user = User(name=f'{marker}-{len(users)}', email=f'{uuid4()}@example.com', role=role, password_hash='test-only', is_active=active)
            self.db.add(user)
            users.append(user)
        await self.db.flush()
        response = await self.client.get('/api/v1/catalog/fae-options')
        self.assertEqual(response.status_code, 200, response.text)
        options = {option['value']: option['label'] for option in response.json()}
        self.assertEqual(options[str(users[0].id)], users[0].name)
        for user in users[1:]:
            self.assertNotIn(str(user.id), options)
        customer = (await self.client.post('/api/v1/catalog/customers', json={'company_name': marker, 'country_code': 'CN', 'level': 'SMB'})).json()
        product = (await self.client.post('/api/v1/catalog/products', json={'type': 'OTT', 'model': marker, 'chipset': 'Test', 'system': 'Test'})).json()
        body = {'number': marker, 'pm': 'PM', 'start_date': '2026-10-19', 'stage': 'EV', 'customer_id': customer['id'], 'product_id': product['id'], 'fae_id': str(users[0].id)}
        response = await self.client.post('/api/v1/catalog/projects', json=body)
        self.assertEqual(response.status_code, 201, response.text)
        project = response.json()
        self.assertEqual(project['fae_name'], users[0].name)
        for user_id in [str(user.id) for user in users[1:]] + [str(uuid4())]:
            response = await self.client.put('/api/v1/catalog/projects/' + project['id'], json={**body, 'fae_id': user_id, 'revision': 1})
            self.assertEqual(response.status_code, 422, response.text)
        result = (await self.client.get('/api/v1/catalog/projects', params={'q': users[0].name, 'sort': 'fae_name'})).json()
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['fae_id'], str(users[0].id))
        response = await self.client.put('/api/v1/catalog/projects/' + project['id'], json={**body, 'fae_id': None, 'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['fae_name'])
        self.assertIsNone(response.json()['fae_id'])

    async def test_customer_names_business_and_sorting(self):
        marker = f'Names-{uuid4()}'
        body = {'company_name': marker, 'country_code': 'CN', 'level': 'SMB', 'business': ['Alice', 'Bob', 'Alice']}

        async def create(payload):
            response = await self.client.post('/api/v1/catalog/customers', json=payload)
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()

        first = await create(body)
        second = await create(body)
        self.assertEqual(first['display_name'], 'China-' + marker)
        self.assertEqual(second['display_name'], first['display_name'] + ' (2)')
        self.assertEqual(first['business'], ['Alice', 'Bob'])
        self.assertNotIn('city_id', first)
        self.assertNotIn('city_name', first)
        self.assertIn('Alice', (await self.client.get('/api/v1/catalog/business-options')).json())
        updated = await self.client.put('/api/v1/catalog/customers/' + second['id'], json={**body, 'level': 'KA', 'revision': 1})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['display_name'], second['display_name'])
        # Trash still occupies a name; deleting the actual row releases it.
        await self.client.delete('/api/v1/catalog/customers/' + first['id'], params={'revision': 1})
        third = await create(body)
        self.assertEqual(third['display_name'], first['display_name'] + ' (3)')
        await self.db.execute(delete(Customer).where(Customer.id == second['id']))
        await self.db.commit()
        fourth = await create(body)
        self.assertEqual(fourth['display_name'], first['display_name'] + ' (2)')
        await self.db.execute(delete(Customer).where(Customer.id == first['id']))
        await self.db.commit()
        fifth = await create(body)
        self.assertEqual(fifth['display_name'], first['display_name'])
        # Literal parentheses in company names must not collide with generated names.
        collision = await create({**body, 'company_name': marker + ' (2)'})
        self.assertEqual(collision['display_name'], first['display_name'] + ' (2) (2)')
        # Renaming releases the old name without renumbering surviving rows.
        renamed = await self.client.put('/api/v1/catalog/customers/' + fourth['id'], json={**body, 'company_name': marker + '-renamed', 'revision': 1})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual((await create(body))['display_name'], first['display_name'] + ' (2)')
        for field in ('company_name', 'country_name', 'level', 'business', 'updated_at'):
            response = await self.client.get('/api/v1/catalog/customers', params={'q': marker, 'sort': field, 'direction': 'asc'})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await self.client.post('/api/v1/catalog/customers', json={**body, 'city_id': 'obsolete'})).status_code, 422)

    async def test_product_fingerprint_and_thirty_row_pagination(self):
        marker = f'Page-{uuid4()}'
        for index in range(31):
            response = await self.client.post('/api/v1/catalog/products', json={
                'type': 'OTT', 'model': f'{marker}-{index:02}', 'chipset': 'Test', 'system': 'Test',
                'repository_url': 'https://example.com/firmware', 'fingerprint': 'manual fingerprint',
            })
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()['fingerprint'], 'manual fingerprint')
        first = (await self.client.get('/api/v1/catalog/products', params={'q': marker, 'sort': 'model', 'direction': 'asc'})).json()
        second = (await self.client.get('/api/v1/catalog/products', params={'q': marker, 'sort': 'model', 'direction': 'asc', 'page': 2})).json()
        self.assertEqual(first['total'], 31)
        self.assertEqual(len(first['items']), 30)
        self.assertEqual(len(second['items']), 1)
        self.assertTrue(first['items'][-1]['model'].endswith('-29'))
        self.assertTrue(second['items'][0]['model'].endswith('-30'))
        for field in ('chipset', 'system', 'type'):
            response = await self.client.get('/api/v1/catalog/products', params={'q': marker, 'sort': field})
            self.assertEqual(response.status_code, 200, response.text)
    async def test_product_names_reuse_and_project_labels(self):
        marker = f'Product-names-{uuid4()}'
        body = {'type': 'OTT', 'model': marker, 'chipset': 'Test', 'system': 'Test'}
        async def create(payload=body):
            response = await self.client.post('/api/v1/catalog/products', json=payload)
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()
        first, second, third = await create(), await create(), await create()
        base = 'OTT-' + marker
        self.assertEqual([r['display_name'] for r in (first, second, third)], [base, base + ' (2)', base + ' (3)'])
        response = await self.client.delete('/api/v1/catalog/products/' + second['id'], params={'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await create())['display_name'], base + ' (4)')
        await self.db.execute(delete(Product).where(Product.id.in_([first['id'], second['id']])))
        await self.db.commit()
        self.assertEqual((await create())['display_name'], base)
        reused = await create()
        self.assertEqual(reused['display_name'], base + ' (2)')
        literal = await create({**body, 'model': marker + ' (2)'})
        self.assertEqual(literal['display_name'], base + ' (2) (2)')
        customer = await self.client.post('/api/v1/catalog/customers', json={'company_name': marker, 'country_code': 'CN', 'level': 'KA'})
        project = await self.client.post('/api/v1/catalog/projects', json={'number': marker, 'pm': 'PM', 'stage': 'EV', 'start_date': '2026-10-20', 'customer_id': customer.json()['id'], 'product_id': reused['id']})
        self.assertEqual(project.status_code, 201, project.text)
        self.assertEqual(project.json()['product_name'], base + ' (2)')
        changed = await self.client.put('/api/v1/catalog/products/' + reused['id'], json={**body, 'model': marker + '-renamed', 'revision': 1})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((await create())['display_name'], base + ' (2)')

    async def asyncSetUp(self):
        engine.echo = False
        self.connection = await engine.connect()
        self.transaction = await self.connection.begin()
        self.db = AsyncSession(bind=self.connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
        await self.db.execute(insert(CatalogOption).values([{'category': 'contact_method', 'value': value} for value in ('email', 'Slack')]).on_conflict_do_nothing())
        await self.db.execute(insert(CatalogOption).values([{'category': 'project_pm', 'value': value} for value in ('PM', 'Test PM', 'Test')]).on_conflict_do_nothing())
        self.user = await self.db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
        self.assertIsNotNone(self.user)

        async def db_override():
            yield self.db

        async def user_override():
            return self.user

        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_current_user] = user_override
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.transaction.rollback()
        await self.connection.close()
        await engine.dispose()

    async def test_catalog_workflow(self):
        c = self.client
        country_rows = (await c.get('/api/v1/catalog/locations/countries')).json()
        self.assertGreater(len(country_rows), 200)
        customer = {'company_name': 'Catalog test company', 'country_code': 'CN', 'business': ['Alice', 'Bob'], 'level': 'KA', 'contacts': [{'name': 'Test person', 'gender': 'unspecified', 'position': 'PM', 'methods': [{'type': 'email', 'value': 'test@example.com'}, {'type': 'Slack', 'value': 'Test group'}], 'notes': 'Test note'}], 'notes': 'Company note'}
        response = await c.post('/api/v1/catalog/customers', json=customer)
        self.assertEqual(response.status_code, 201, response.text)
        customer_row = response.json()
        self.assertEqual(customer_row['created_by'], str(self.user.id))
        self.assertEqual(len(customer_row['contacts'][0]['methods']), 2)
        bad = await c.post('/api/v1/catalog/customers', json={**customer, 'country_code': 'ZZ'})
        self.assertEqual(bad.status_code, 422)
        bad = await c.post('/api/v1/catalog/customers', json={**customer, 'created_by': str(self.user.id)})
        self.assertEqual(bad.status_code, 422)
        product = {'type': 'OTT', 'model': 'Catalog-test-model', 'chipset': 'Test-chip', 'system': 'Test-OS', 'repository_url': 'https://example.com/repo', 'notes': ''}
        response = await c.post('/api/v1/catalog/products', json=product)
        self.assertEqual(response.status_code, 201, response.text)
        product_row = response.json()
        self.assertIn(product['model'], (await c.get('/api/v1/catalog/suggestions/model', params={'q': 'Catalog-test'})).json())
        project = {'number': 'TEST-001', 'pm': 'Test PM', 'start_date': '2026-09-01', 'stage': 'EVT', 'customer_id': customer_row['id'], 'product_id': product_row['id']}
        response = await c.post('/api/v1/catalog/projects', json=project)
        self.assertEqual(response.status_code, 201, response.text)
        project_row = response.json()
        self.assertIn('Catalog-test-model-TEST-001', project_row['display_name'])
        response = await c.put('/api/v1/catalog/products/' + product_row['id'], json={**product, 'model': 'Changed-model', 'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['revision'], 2)
        self.assertEqual(response.json()['created_at'], product_row['created_at'])
        self.assertEqual(response.json()['updated_by'], str(self.user.id))
        self.assertNotEqual(response.json()['updated_at'], product_row['updated_at'])
        conflict = await c.put('/api/v1/catalog/products/' + product_row['id'], json={**product, 'revision': 1})
        self.assertEqual(conflict.status_code, 409)
        detail = (await c.get('/api/v1/catalog/projects/' + project_row['id'])).json()
        self.assertIn('Changed-model', detail['display_name'])
        rows = (await c.get('/api/v1/catalog/projects', params={'q': 'TEST-001', 'filter_field': 'stage', 'filter_value': 'EVT', 'sort': 'name', 'direction': 'asc', 'page_size': 1})).json()
        self.assertEqual(rows['total'], 1)
        self.assertEqual(rows['items'][0]['id'], project_row['id'])
        for invalid in ({'start_date': '2026-02-30'}, {'stage': 'BAD'}, {'customer_id': '00000000-0000-0000-0000-000000000000'}):
            self.assertEqual((await c.post('/api/v1/catalog/projects', json={**project, **invalid})).status_code, 422)
        self.assertEqual((await c.post('/api/v1/catalog/products', json={**product, 'repository_url': 'javascript:alert(1)'})).status_code, 422)
        self.assertEqual((await c.get('/api/v1/catalog/projects', params={'sort': 'invalid'})).status_code, 422)
        app.dependency_overrides.pop(get_current_user)
        self.assertIn((await c.get('/api/v1/catalog/customers')).status_code, (401, 403))

    async def test_trash_references_restore_and_permissions(self):
        c = self.client
        users = []
        for role in (UserRole.engineer, UserRole.leader, UserRole.developer):
            user = User(name='Catalog trash test', email=f'{uuid4()}@example.com',
                        role=role, password_hash='test-only', is_active=True)
            self.db.add(user)
            users.append(user)
        await self.db.flush()
        self.user = users[0]
        marker = f'Trash-test-{uuid4()}'

        async def create(kind, body):
            response = await c.post(f'/api/v1/catalog/{kind}', json=body)
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()

        customer = await create('customers', {'company_name': marker, 'country_code': 'CN',
                                             'level': 'KA'})
        product_body = {'type': 'OTT', 'model': marker, 'chipset': 'Test', 'system': 'Test'}
        product = await create('products', product_body)
        project_body = {'number': marker, 'pm': 'Test', 'start_date': '2026-09-01', 'stage': 'EV',
                        'customer_id': customer['id'], 'product_id': product['id']}
        project = await create('projects', project_body)
        project_url = '/api/v1/catalog/projects/' + project['id']
        ticket_body = {'title': marker, 'source': 'Email', 'project_id': project['id']}
        response = await c.post('/api/v1/tickets/', json=ticket_body)
        self.assertEqual(response.status_code, 201, response.text)
        ticket = response.json()
        # References block soft deletion, including references from trashed projects.
        self.assertEqual((await c.delete(project_url, params={'revision': 1})).status_code, 409)
        self.assertEqual((await c.delete('/api/v1/tickets/' + ticket['id'], params={'revision': 1})).status_code, 200)
        self.assertEqual((await c.delete(project_url, params={'revision': 1})).status_code, 200)
        for kind, row in (('customers', customer), ('products', product)):
            self.assertEqual((await c.delete(f'/api/v1/catalog/{kind}/{row["id"]}', params={'revision': 1})).status_code, 409)
        self.assertEqual((await c.post('/api/v1/tickets/', json=ticket_body)).status_code, 422)
        self.assertEqual((await c.put(project_url, json={**project_body, 'revision': 2})).status_code, 409)
        active = (await c.get('/api/v1/catalog/projects', params={'q': marker})).json()
        self.assertEqual(active['total'], 0)
        deleted = (await c.get('/api/v1/catalog/projects', params={'q': marker, 'trash': True})).json()['items'][0]
        self.assertEqual(deleted['deleted_by'], str(users[0].id))
        self.assertIsNotNone(deleted['deleted_at'])
        self.assertEqual((await c.post(project_url + '/restore', params={'revision': 1})).status_code, 409)
        # Another team member may restore; numbering survives deletion and restoration.
        self.user = users[1]
        response = await c.post(project_url + '/restore', params={'revision': 2})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['deleted_at'])
        self.assertEqual(response.json()['updated_by'], str(users[1].id))
        response = await c.post('/api/v1/tickets/', json=ticket_body)
        self.assertEqual(response.status_code, 201, response.text)
        second = response.json()
        self.assertEqual(second['project_seq'], ticket['project_seq'] + 1)
        self.assertEqual((await c.delete('/api/v1/tickets/' + second['id'], params={'revision': 1})).status_code, 200)
        self.assertEqual((await c.delete(project_url, params={'revision': 3})).status_code, 200)
        for user in users[:2]:
            self.user = user
            self.assertEqual((await c.delete('/api/v1/catalog/projects/trash')).status_code, 403)
        self.user = users[2]
        response = await c.delete('/api/v1/catalog/projects/trash')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreaterEqual(response.json()['deleted_count'], 1)
        self.assertEqual((await c.get(project_url)).status_code, 404)
        # An unreferenced product can be deleted by an engineer, but cannot be selected.
        self.user = users[0]
        product_url = '/api/v1/catalog/products/' + product['id']
        self.assertEqual((await c.delete(product_url, params={'revision': 1})).status_code, 200)
        self.assertEqual((await c.get('/api/v1/catalog/suggestions/model', params={'q': marker})).json(), [])
        self.assertEqual((await c.post('/api/v1/catalog/projects', json=project_body)).status_code, 422)
        self.assertEqual((await c.put(product_url, json={**product_body, 'revision': 2})).status_code, 409)
        self.assertEqual((await c.post(product_url + '/restore', params={'revision': 2})).status_code, 200)
        self.assertEqual((await c.delete(product_url, params={'revision': 3})).status_code, 200)
        self.assertEqual((await c.delete('/api/v1/catalog/customers/' + customer['id'], params={'revision': 1})).status_code, 200)
        self.user = users[2]
        for kind, row in (('customers', customer), ('products', product)):
            response = await c.delete(f'/api/v1/catalog/{kind}/trash')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual((await c.get(f'/api/v1/catalog/{kind}/{row["id"]}')).status_code, 404)
