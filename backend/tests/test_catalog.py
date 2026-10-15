"""Integration tests against the local development schema; all writes roll back."""
import unittest
from uuid import uuid4
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database import engine, get_db
from app.middleware.auth import get_current_user
from app.models.user import User, UserRole


class CatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        engine.echo = False
        self.connection = await engine.connect()
        self.transaction = await self.connection.begin()
        self.db = AsyncSession(bind=self.connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
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
        cities = (await c.get('/api/v1/catalog/locations/cities', params={'country': 'CN', 'q': 'Shenzhen'})).json()
        self.assertTrue(cities)
        customer = {'company_name': 'Catalog test company', 'country_code': 'CN', 'city_id': cities[0]['value'], 'level': 'KA', 'contacts': [{'name': 'Test person', 'gender': 'unspecified', 'position': 'PM', 'methods': [{'type': 'email', 'value': 'test@example.com'}, {'type': 'Slack', 'value': 'Test group'}], 'notes': 'Test note'}], 'notes': 'Company note'}
        response = await c.post('/api/v1/catalog/customers', json=customer)
        self.assertEqual(response.status_code, 201, response.text)
        customer_row = response.json()
        self.assertEqual(customer_row['created_by'], str(self.user.id))
        self.assertEqual(len(customer_row['contacts'][0]['methods']), 2)
        bad = await c.post('/api/v1/catalog/customers', json={**customer, 'country_code': 'US'})
        self.assertEqual(bad.status_code, 422)
        bad = await c.post('/api/v1/catalog/customers', json={**customer, 'created_by': str(self.user.id)})
        self.assertEqual(bad.status_code, 422)
        product = {'type': 'OTT', 'model': 'Catalog-test-model', 'chipset': 'Test-chip', 'system': 'Test-OS', 'repository_url': 'https://example.com/repo', 'notes': ''}
        response = await c.post('/api/v1/catalog/products', json=product)
        self.assertEqual(response.status_code, 201, response.text)
        product_row = response.json()
        self.assertIn(product['model'], (await c.get('/api/v1/catalog/suggestions/model', params={'q': 'Catalog-test'})).json())
        project = {'number': 'TEST-001', 'pm': 'Test PM', 'start_month': '2026-09', 'stage': 'EVT', 'customer_id': customer_row['id'], 'product_id': product_row['id']}
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
        for invalid in ({'start_month': '2026-13'}, {'stage': 'BAD'}, {'customer_id': '00000000-0000-0000-0000-000000000000'}):
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
                                             'city_id': '1795565', 'level': 'KA'})
        product_body = {'type': 'OTT', 'model': marker, 'chipset': 'Test', 'system': 'Test'}
        product = await create('products', product_body)
        project_body = {'number': marker, 'pm': 'Test', 'start_month': '2026-09', 'stage': 'EV',
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
