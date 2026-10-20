"""Local development integration tests. Records roll back; sequence numbers stay consumed."""
import unittest
from datetime import date
import httpx
from uuid import uuid4
from unittest.mock import patch, AsyncMock
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from app.models.catalog import CatalogOption
from sqlalchemy.ext.asyncio import AsyncSession
from app.main import app
from app.database import engine, get_db
from app.middleware.auth import get_current_user
from app.models.user import User, UserRole

class TicketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        engine.echo = False
        self.connection = await engine.connect()
        self.transaction = await self.connection.begin()
        self.db = AsyncSession(bind=self.connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
        await self.db.execute(insert(CatalogOption).values(category='project_pm', value='Test PM').on_conflict_do_nothing())
        self.users = []
        for role in (UserRole.developer, UserRole.leader, UserRole.engineer, UserRole.engineer, UserRole.engineer):
            user = User(name='Ticket test', email=f'{uuid4()}@example.com', role=role, password_hash='test-only', is_active=True)
            self.db.add(user)
            self.users.append(user)
        await self.db.flush()
        self.user = self.users[0]
        async def database(): yield self.db
        async def current(): return self.user
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = current
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')
        c = self.client
        customer = await c.post('/api/v1/catalog/customers', json={'company_name':'Ticket test company','country_code':'CN','level':'KA'})
        self.assertEqual(customer.status_code,201,customer.text)
        product = await c.post('/api/v1/catalog/products',json={'type':'OTT','model':'TestModel','chipset':'Chip','system':'OS'})
        self.assertEqual(product.status_code,201,product.text)
        self.projects=[]
        for number in ('A','B'):
            response=await c.post('/api/v1/catalog/projects',json={'number':number,'pm':'Test PM','start_date':'2026-09-01','stage':'EV','customer_id':customer.json()['id'],'product_id':product.json()['id']})
            self.assertEqual(response.status_code,201,response.text)
            self.projects.append(response.json()['id'])
        self.body={'title':'Test ticket','description':'## Repro\n- Step one','project_id':self.projects[0],'source':'Email','raw_report':'Original report'}

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.transaction.rollback()
        await self.connection.close()
        await engine.dispose()

    async def create(self, **values):
        r=await self.client.post('/api/v1/tickets/',json={**self.body,**values})
        self.assertEqual(r.status_code,201,r.text)
        return r.json()

    async def test_numbering_permissions_and_transfers(self):
        c=self.client
        self.user=self.users[2]
        first=await self.create()
        self.assertEqual(first['assignee']['id'],str(self.user.id))
        self.assertEqual(first['updater']['id'],str(self.user.id))
        self.assertEqual(first['project_seq'],1)
        self.assertTrue(first['display_name'].endswith(f"-Email1-TestModel-ft{first['system_seq']}"))
        second=await self.create(source='微信',source_number='EVBOX-1299')
        self.assertEqual(second['project_seq'],2)
        self.assertIn('-EVBOX-1299-TestModel-',second['display_name'])
        r=await c.delete('/api/v1/tickets/'+second['id'],params={'revision':1})
        self.assertEqual(r.status_code,200,r.text)
        third=await self.create(source='WhatsApp')
        self.assertEqual(third['project_seq'],3)
        self.assertGreater(third['system_seq'],second['system_seq'])
        other=await self.create(project_id=self.projects[1])
        self.assertEqual(other['project_seq'],1)
        self.assertGreater(other['system_seq'],third['system_seq'])
        url='/api/v1/tickets/'+first['id']
        r=await c.patch(url,json={'project_id':self.projects[1],'revision':1})
        self.assertEqual(r.status_code,200,r.text)
        moved=r.json()
        self.assertEqual(moved['project_seq'],2)
        self.assertEqual(moved['ticket_no'],first['ticket_no'])
        self.assertEqual(moved['created_at'],first['created_at'])
        self.assertEqual((await c.patch(url,json={'status':'resolved','revision':1})).status_code,409)
        r=await c.patch(url,json={'project_id':self.projects[0],'revision':2,'assignee_id':str(self.users[3].id)})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['project_seq'],4)
        # An unrelated engineer can view everyone, but cannot update/delete/comment/run AI.
        self.user=self.users[4]
        self.assertEqual((await c.get(url)).status_code,200)
        self.assertFalse((await c.get(url)).json()['can_edit'])
        self.assertEqual((await c.get('/api/v1/tickets/',params={'mine':True})).json(),[])
        self.assertGreaterEqual(len((await c.get('/api/v1/tickets/')).json()),3)
        self.assertEqual((await c.patch(url,json={'title':'intrusion','revision':3})).status_code,403)
        self.assertEqual((await c.delete(url,params={'revision':3})).status_code,403)
        self.assertEqual((await c.post(url+'/comments',json={'content':'intrusion'})).status_code,403)
        with patch('app.services.ai_service.analyze_ticket',new_callable=AsyncMock) as ai:
            self.assertEqual((await c.post('/api/v1/ai/analyze-ticket/'+first['id'])).status_code,403)
            ai.assert_not_called()
        # Assignee updates, so original creator is no longer automatically an editor.
        self.user=self.users[3]
        r=await c.patch(url,json={'status':'verifying','revision':3})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['updater']['id'],str(self.user.id))
        self.user=self.users[2]
        self.assertEqual((await c.patch(url,json={'status':'resolved','revision':4})).status_code,403)
        # Leadership can transfer; only the new last updater and assignee retain engineer access.
        self.user=self.users[1]
        r=await c.patch(url,json={'assignee_id':str(self.users[4].id),'revision':4,'status':'resolved'})
        self.assertEqual(r.status_code,200,r.text)
        self.assertIsNotNone(r.json()['resolved_at'])
        self.user=self.users[3]
        self.assertEqual((await c.delete(url,params={'revision':5})).status_code,403)
        self.user=self.users[0]
        self.assertEqual((await c.delete(url,params={'revision':4})).status_code,409)
        self.assertEqual((await c.delete(url,params={'revision':5})).status_code,200)
        self.assertEqual((await c.get(url)).status_code,404)

    async def test_validation_and_filtering(self):
        c=self.client
        for values in ({'project_id':str(uuid4())},{'assignee_id':str(uuid4())},{'title':'  '},{'source':''},{'priority':'high'},{'status':'closed'},{'source_url':'javascript:alert(1)'},{'tapd_created':True},{'created_by':str(self.user.id)}):
            r=await c.post('/api/v1/tickets/',json={**self.body,**values})
            self.assertEqual(r.status_code,422,r.text)
        row=await self.create(tapd_created=True,tapd_url='https://www.tapd.cn/test',priority='critical')
        url='/api/v1/tickets/'+row['id']
        for values in ({'title':None},{'assignee_id':None},{'project_id':None},{'status':None},{'system_seq':1}):
            self.assertEqual((await c.patch(url,json={'revision':1,**values})).status_code,422)
        r=await c.patch(url,json={'tapd_created':False,'revision':1})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['tapd_url'],'')
        await self.create(priority='trivial')
        rows=(await c.get('/api/v1/tickets/',params={'project_id':self.projects[0],'priority':'critical','q':'Test ticket'})).json()
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['id'],row['id'])
        self.assertEqual(rows[0]['project_summary'], 'Ticket test company-TestModel')
        self.assertEqual(rows[0]['description'], self.body['description'])
        self.assertEqual(rows[0]['next_plan'], '')
        assigned = await self.create(assignee_id=str(self.users[3].id), next_plan='Check logs')
        filtered = (await c.get('/api/v1/tickets/', params={'assignee_id': str(self.users[3].id), 'project_id': self.projects[0]})).json()
        self.assertEqual([t['id'] for t in filtered], [assigned['id']])
        self.assertEqual(filtered[0]['next_plan'], 'Check logs')
        for term, expected_ids in (
            ('Check logs', {assigned['id']}),
            ('Critical', {row['id']}),
            ('新工单', {row['id'], assigned['id']}),
            (self.users[3].email, {assigned['id']}),
        ):
            response = await c.get('/api/v1/tickets/', params={'q': term, 'project_id': self.projects[0]})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(expected_ids.issubset({t['id'] for t in response.json()}))
        own = (await c.get('/api/v1/tickets/', params={'mine': True, 'assignee_id': str(self.users[3].id), 'project_id': self.projects[0]})).json()
        self.assertNotIn(assigned['id'], [t['id'] for t in own])
        rows=(await c.get('/api/v1/tickets/',params={'project_id':self.projects[0],'sort':'priority','direction':'desc'})).json()
        self.assertEqual(rows[0]['priority'],'critical')
        stats=(await c.get('/api/v1/tickets/stats')).json()
        self.assertIn('reproducing',stats)
        app.dependency_overrides.pop(get_current_user)
        self.assertIn((await c.get('/api/v1/tickets/')).status_code,(401,403))

    async def test_open_closed_filter(self):
        c = self.client
        rows = {}
        for status in ('open', 'reproducing', 'in_progress', 'verifying', 'pending', 'resolved'):
            rows[status] = await self.create(status=status)
        params = {'project_id': self.projects[0]}
        for state, expected in (
            ('all', set(rows)),
            ('open', set(rows) - {'resolved'}),
            ('closed', {'resolved'}),
        ):
            response = await c.get('/api/v1/tickets/', params={**params, 'state': state, 'mine': True})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual({r['id'] for r in response.json()}, {rows[s]['id'] for s in expected})
        # Search and assignee filtering must still intersect with the lifecycle filter.
        other = await self.create(status='resolved', title='Closed assigned ticket', assignee_id=str(self.users[3].id))
        response = await c.get('/api/v1/tickets/', params={**params, 'state': 'closed', 'q': 'Closed assigned', 'assignee_id': str(self.users[3].id)})
        self.assertEqual([r['id'] for r in response.json()], [other['id']])
        response = await c.get('/api/v1/tickets/', params={**params, 'state': 'open', 'q': 'Closed assigned'})
        self.assertEqual(response.json(), [])
        self.assertEqual((await c.get('/api/v1/tickets/', params={'state': 'invalid'})).status_code, 422)

    async def test_created_date_range_boundaries(self):
        from datetime import datetime, timezone
        from sqlalchemy import update
        from app.models.ticket import Ticket
        c = self.client
        rows = []
        for hour in (15, 16, 23):
            row = await self.create()
            await self.db.execute(update(Ticket).where(Ticket.id == row['id']).values(
                created_at=datetime(2026, 10, 14, hour, 0, tzinfo=timezone.utc)))
            rows.append(row)
        next_day = await self.create()
        await self.db.execute(update(Ticket).where(Ticket.id == next_day['id']).values(
            created_at=datetime(2026, 10, 15, 16, 0, tzinfo=timezone.utc)))
        await self.db.commit()
        # October 15 in UTC+8 includes 14th 16:00 UTC; next local midnight is excluded.
        params = {'project_id': self.projects[0], 'mine': True,
                  'created_from': '2026-10-15T00:00:00+08:00',
                  'created_before': '2026-10-16T00:00:00+08:00'}
        response = await c.get('/api/v1/tickets/', params=params)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual({t['id'] for t in response.json()}, {rows[1]['id'], rows[2]['id']})
        response = await c.get('/api/v1/tickets/', params={**params, 'state': 'closed'})
        self.assertEqual(response.json(), [])
        response = await c.get('/api/v1/tickets/', params={'project_id': self.projects[0], 'created_before': params['created_from']})
        self.assertEqual([t['id'] for t in response.json()], [rows[0]['id']])
        for values in ({'created_from': 'bad-date'}, {'created_from': '2026-10-15T00:00:00'},
                       {'created_from': params['created_before'], 'created_before': params['created_from']}):
            self.assertEqual((await c.get('/api/v1/tickets/', params=values)).status_code, 422)

    async def test_comments_ai_and_email_approval(self):
        from app.models.email_account import EmailAccount, SyncedEmail, PreTicket
        c=self.client
        ticket=await self.create()
        url='/api/v1/tickets/'+ticket['id']
        r=await c.post(url+'/comments',json={'content':'Verified comment'})
        self.assertEqual(r.status_code,201,r.text)
        self.assertEqual((await c.get(url)).json()['revision'],2)
        with patch('app.services.ai_service.analyze_ticket',new_callable=AsyncMock,return_value='## Analysis') as ai:
            r=await c.post('/api/v1/ai/analyze-ticket/'+ticket['id'])
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(ai.call_args.args[0]['raw_report'],'Original report')
            self.assertEqual(ai.call_args.args[0]['product_name'],'TestModel')
        self.assertEqual((await c.get(url)).json()['revision'],3)
        account=EmailAccount(user_id=self.user.id,email_address=self.user.email,imap_host='example.com',username='test',password_encrypted='test')
        self.db.add(account)
        await self.db.flush()
        email=SyncedEmail(account_id=account.id,message_id=str(uuid4()),body_text='Original email body')
        self.db.add(email)
        await self.db.flush()
        pre=PreTicket(email_id=email.id,creator_id=self.user.id,title='Email test',priority='high')
        self.db.add(pre)
        await self.db.flush()
        approval='/api/v1/email/pre-tickets/'+str(pre.id)+'/approve'
        self.assertEqual((await c.post(approval,json={})).status_code,422)
        r=await c.post(approval,json={'project_id':self.projects[0]})
        self.assertEqual(r.status_code,200,r.text)
        created=r.json()['ticket_id']
        row=(await c.get('/api/v1/tickets/'+created)).json()
        self.assertEqual(row['raw_report'],'Original email body')
        self.assertEqual(row['priority'],'major')
        self.assertEqual(row['project_seq'],2)
        self.assertEqual((await c.post(approval,json={'project_id':self.projects[0]})).status_code,400)
        self.assertEqual((await c.delete('/api/v1/tickets/'+created,params={'revision':1})).status_code,200)
        await self.db.refresh(pre)
        self.assertIsNone(pre.created_ticket_id)


class TicketConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_number_allocation_and_edits(self):
        import asyncio
        from sqlalchemy import delete, text
        from app.database import AsyncSessionLocal
        from app.models.catalog import Customer, Product, Project
        from app.models.ticket import Ticket
        from app.schemas.ticket import CreateTicketRequest, UpdateTicketRequest
        from app.services.ticket_service import create_ticket, update_ticket
        from fastapi import HTTPException
        engine.echo=False
        customer_id, product_id, project_id = uuid4(), uuid4(), uuid4()
        async with AsyncSessionLocal() as db:
            user=await db.scalar(select(User).where(User.is_active.is_(True),User.role==UserRole.developer).limit(1))
            self.assertIsNotNone(user)
            db.add(Customer(id=customer_id,company_name='Concurrent test',country_code='CN',country_name='China',identification_name=f'China-Concurrent-{customer_id}',level='KA',created_by=user.id,updated_by=user.id))
            db.add(Product(id=product_id,identification_name=f'OTT-Concurrent test-{product_id}',type='OTT',model='Concurrent test',chipset='Test',system='Test',created_by=user.id,updated_by=user.id))
            await db.flush()
            db.add(Project(id=project_id,number='Concurrent test',pm='Test',start_date=date(2026, 9, 1),stage='EV',customer_id=customer_id,product_id=product_id,created_by=user.id,updated_by=user.id))
            await db.commit()
        try:
            async def create():
                async with AsyncSessionLocal() as db:
                    t=await create_ticket(CreateTicketRequest(title='Concurrent test',source='Email',project_id=project_id),db,user)
                    return t.id,t.system_seq,t.project_seq,t.revision
            rows=await asyncio.gather(*(create() for _ in range(6)))
            self.assertEqual(len({r[1] for r in rows}),6)
            self.assertEqual(sorted(r[2] for r in rows),list(range(1,7)))
            async def edit():
                async with AsyncSessionLocal() as db:
                    try:
                        await update_ticket(rows[0][0],UpdateTicketRequest(revision=1,status='reproducing'),db,user)
                        return 200
                    except HTTPException as e:
                        return e.status_code
            self.assertEqual(sorted(await asyncio.gather(edit(),edit())),[200,409])
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(Ticket).where(Ticket.project_id==project_id))
                await db.execute(text('DELETE FROM ticket_project_counters WHERE project_id=:id'),{'id':project_id})
                await db.execute(delete(Project).where(Project.id==project_id))
                await db.execute(delete(Product).where(Product.id==product_id))
                await db.execute(delete(Customer).where(Customer.id==customer_id))
                await db.commit()
            await engine.dispose()
