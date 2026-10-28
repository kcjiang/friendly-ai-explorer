import json
import unittest
from uuid import uuid4
from unittest.mock import AsyncMock, patch
from app.services import command_files

from app.services import storage_service as s
from tests import test_storage


class CommandFilesTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_storage.StorageTests.asyncSetUp
    asyncTearDown = test_storage.StorageTests.asyncTearDown
    user = test_storage.StorageTests.user
    upload = test_storage.StorageTests.upload

    def catalog(self):
        return {"version": 1, "transport": "adb", "commands": [
            {"id": str(uuid4()), "name": "Model", "command": "getprop ro.product.model",
             "group": "General", "confirmBeforeRun": False}
        ]}

    async def load(self):
        return await self.client.get('/api/v1/debug/commands', params={'device_type': 'adb'})

    async def save(self, catalog, revision='missing'):
        return await self.client.put('/api/v1/debug/commands', json={'catalog': catalog, 'revision': revision})

    async def test_permissions_storage_and_stale_save(self):
        self.assertEqual((await self.load()).json()['catalog']['commands'], [])
        catalog = self.catalog()
        self.assertEqual((await self.save(catalog)).status_code, 403)
        self.current = self.dev
        result = await self.save(catalog)
        self.assertEqual(result.status_code, 200, result.text)
        target = s.disk_path('public', 'Commands/ADB/adb_cmd_default.json')
        self.assertEqual(json.loads(target.read_text()), catalog)
        self.assertEqual((await self.save(catalog)).status_code, 409)
        self.current = self.other
        self.assertEqual((await self.load()).json()['catalog'], catalog)
        entry = await s.active(self.db, 'public', 'Commands/ADB/adb_cmd_default.json')
        catalog['commands'][0]['name'] = 'Changed through file manager'
        edit = await self.client.put(f'/api/v1/files/{entry.id}/content', json={'content': json.dumps(catalog), 'revision': result.json()['revision']})
        self.assertEqual(edit.status_code, 200, edit.text)
        self.assertEqual((await self.load()).json()['catalog'], catalog)

    async def test_invalid_file_and_exact_path(self):
        self.current = self.dev
        catalog = self.catalog()
        self.assertEqual((await self.save(catalog)).status_code, 200)
        target = s.disk_path('public', 'Commands/ADB/adb_cmd_default.json')
        target.rename(target.with_name('adb_cmd_default (2).json'))
        self.assertEqual((await self.load()).json()['catalog']['commands'], [])
        target.write_text('{invalid')
        self.assertEqual((await self.load()).status_code, 422)
        self.assertEqual((await self.save(catalog)).status_code, 422)
        self.assertEqual(target.read_text(), '{invalid')

    async def test_duplicate_names_allowed_ids_unique(self):
        self.current = self.dev
        catalog = self.catalog()
        catalog['commands'].append({**catalog['commands'][0], 'id': str(uuid4())})
        self.assertEqual((await self.save(catalog)).status_code, 200)
        catalog['commands'][1]['id'] = catalog['commands'][0]['id']
        self.assertEqual((await self.save(catalog)).status_code, 422)

    async def test_copy_replace_keep_skip(self):
        source = await self.upload('adb_cmd_default.json', b'{"new":true}', space='public')
        destination = await self.upload('adb_cmd_default.json', b'{"old":true}')
        source_id, destination_id = source['id'], destination['id']
        url = f'/api/v1/files/{source_id}/transfer'
        for choice in ('skip', 'keep', 'replace'):
            response = await self.client.post(url, json={'space': 'personal', 'parent': '', 'copy': True, 'conflict': choice})
            self.assertEqual(response.status_code, 200, response.text)
            original = (await self.client.get(f'/api/v1/files/{destination_id}/content')).json()['content']
            self.assertEqual(original, '{"new":true}' if choice == 'replace' else '{"old":true}')
        self.assertTrue(s.disk_path(s.personal(self.owner), 'adb_cmd_default (2).json').exists())

    async def test_personal_space_is_private_and_independent(self):
        catalog = self.catalog()
        personal = {'space': 'personal', 'revision': 'missing', 'catalog': catalog}
        result = await self.client.put('/api/v1/debug/commands', json=personal)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(s.disk_path(s.personal(self.owner), 'Commands/ADB/adb_cmd_default.json').is_file())
        self.assertEqual((await self.load()).json()['catalog']['commands'], [])
        params = {'device_type': 'adb', 'space': 'personal'}
        self.assertEqual((await self.client.get('/api/v1/debug/commands', params=params)).json()['catalog'], catalog)
        self.current = self.other
        self.assertEqual((await self.client.get('/api/v1/debug/commands', params=params)).json()['catalog']['commands'], [])
        self.current = self.dev
        self.assertEqual((await self.client.get('/api/v1/debug/commands', params=params)).json()['catalog']['commands'], [])
        self.assertEqual((await self.save(catalog)).status_code, 200)
        self.current = self.owner
        personal['catalog']['commands'][0]['name'] = 'My updated command'
        personal['revision'] = result.json()['revision']
        self.assertEqual((await self.client.put('/api/v1/debug/commands', json=personal)).status_code, 200)
        self.assertEqual((await self.load()).json()['catalog']['commands'][0]['name'], 'Model')
        self.assertEqual((await self.client.get('/api/v1/debug/commands', params={'device_type': 'adb', 'space': 'personal/other'})).status_code, 422)

    async def test_file_editor_rejects_stale_revision(self):
        self.current = self.dev
        result = await self.save(self.catalog())
        entry = await s.active(self.db, 'public', 'Commands/ADB/adb_cmd_default.json')
        url = f'/api/v1/files/{entry.id}/content'
        old = (await self.client.get(url)).json()
        updated = self.catalog()
        self.assertEqual((await self.save(updated, result.json()['revision'])).status_code, 200)
        stale = await self.client.put(url, json={'content': old['content'], 'revision': old['revision']})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual((await self.load()).json()['catalog'], updated)
        self.assertEqual((await self.client.put(url, json={'content': '{}'})).status_code, 422)

    async def test_strict_file_validation_and_diagnostics(self):
        self.current = self.dev
        catalog = self.catalog()
        self.assertEqual((await self.save(catalog)).status_code, 200)
        target = s.disk_path('public', 'Commands/ADB/adb_cmd_default.json')
        catalog['commands'][0]['confirmBeforRun'] = True
        target.write_text(json.dumps(catalog))
        result = await self.load()
        self.assertEqual(result.status_code, 422)
        self.assertIn('commands.0.confirmBeforRun', result.text)
        self.assertIn('adb_cmd_default.json', result.text)
        target.write_text('{\n invalid}')
        self.assertIn('line 2', (await self.load()).text)
        del catalog['commands'][0]['confirmBeforRun']
        catalog['commands'][0]['confirmBeforeRun'] = 'false'
        self.assertEqual((await self.save(catalog)).status_code, 422)

    async def test_first_save_commit_failure_removes_published_file(self):
        body = command_files.SaveCatalog(catalog=command_files.Catalog.model_validate(self.catalog()), revision='missing', space='personal')
        with patch.object(self.db, 'commit', AsyncMock(side_effect=RuntimeError('commit failed'))):
            with self.assertRaisesRegex(RuntimeError, 'commit failed'):
                await command_files.save(self.db, self.owner, body)
        self.assertFalse(s.disk_path(s.personal(self.owner), 'Commands/ADB/adb_cmd_default.json').exists())
