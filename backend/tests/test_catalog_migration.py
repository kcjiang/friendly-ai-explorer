"""Exercise the real migration in an isolated, rolled-back PostgreSQL schema."""
from pathlib import Path
from uuid import uuid4
import unittest
from app.database import engine


class CatalogMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_dates_names_and_city_removal(self):
        # SQL migrations are mounted separately by Compose; read from test mount.
        root = Path('/catalog-migrations')
        if not root.exists():
            root = Path(__file__).resolve().parents[2] / 'db'
        if (root / 'archive').exists():
            root = root / 'archive'
        if not (root / 'migration_v13_catalog_ui.sql').exists():
            self.skipTest('Mount ./db at /catalog-migrations to run migration verification')
        async with engine.connect() as connection:
            transaction = await connection.begin()
            await connection.exec_driver_sql('SELECT 1')  # start the driver transaction before raw SQL
            raw = (await connection.get_raw_connection()).driver_connection
            try:
                schema = 'catalog_migration_' + uuid4().hex
                await raw.execute(f'CREATE SCHEMA {schema}; SET LOCAL search_path TO {schema}, public')
                legacy = (root / 'migration_v5_catalog.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(legacy)
                user = await raw.fetchval('SELECT id FROM public.users LIMIT 1')
                self.assertIsNotNone(user)
                customer = await raw.fetchval("""INSERT INTO catalog_customers
                    (company_name, country_code, country_name, city_id, city_name, level, created_by, updated_by)
                    VALUES ('Legacy', 'CN', 'China', 'old', 'Shenzhen', 'KA', $1, $1) RETURNING id""", user)
                await raw.execute("""INSERT INTO catalog_customers
                    (company_name, country_code, country_name, city_id, city_name, level, created_by, updated_by)
                    VALUES ('Legacy', 'CN', 'China', 'old', 'Beijing', 'KA', $1, $1)""", user)
                product = await raw.fetchval("""INSERT INTO catalog_products
                    (type, model, chipset, system, created_by, updated_by)
                    VALUES ('OTT', 'Legacy', 'Chip', 'OS', $1, $1) RETURNING id""", user)
                await raw.execute("""INSERT INTO catalog_projects
                    (number, pm, start_month, stage, customer_id, product_id, created_by, updated_by)
                    VALUES ('Legacy', 'PM', '2024-02', 'EV', $1, $2, $3, $3)""", customer, product, user)
                migration = (root / 'migration_v13_catalog_ui.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(migration)
                await raw.execute(migration)  # idempotent for existing deployments
                names = await raw.fetch('SELECT identification_name FROM catalog_customers ORDER BY identification_name')
                self.assertEqual([r[0] for r in names], ['China-Legacy', 'China-Legacy-1'])
                self.assertEqual(str(await raw.fetchval('SELECT start_date FROM catalog_projects')), '2024-02-01')
                options_migration = (root / 'migration_v15_catalog_options.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(options_migration)
                self.assertEqual(await raw.fetchval("SELECT value FROM catalog_options WHERE category='project_pm'"), 'PM')
                await raw.execute("DELETE FROM catalog_options WHERE category='customer_level' AND value='SMB'")
                await raw.execute(options_migration)
                self.assertIsNone(await raw.fetchval("SELECT value FROM catalog_options WHERE category='customer_level' AND value='SMB'"))
                await raw.execute("UPDATE catalog_customers SET level='A long custom customer level'")
                await raw.execute("UPDATE catalog_products SET type='A long custom product type'")
                await raw.execute("UPDATE catalog_projects SET stage='A long custom project stage'")
                await raw.execute("""UPDATE catalog_customers SET contacts='[{"name":"Legacy contact","methods":[{"type":"Legacy tool","value":"123"}]}]'::jsonb""")
                tool_migration = (root / 'migration_v16_contact_method_options.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(tool_migration)
                await raw.execute(tool_migration)
                self.assertEqual(await raw.fetchval("SELECT count(*) FROM catalog_options WHERE category='contact_method' AND value='Legacy tool'"), 1)
                columns = await raw.fetch("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'catalog_customers'", schema)
                self.assertNotIn('city_name', [r[0] for r in columns])
                self.assertNotIn('city_id', [r[0] for r in columns])
                fae_migration = (root / 'migration_v14_project_fae.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(fae_migration)
                await raw.execute(fae_migration)
                self.assertIsNone(await raw.fetchval('SELECT fae_id FROM catalog_projects'))
                self.assertEqual(str(await raw.fetchval('SELECT start_date FROM catalog_projects')), '2024-02-01')
                trash_migration = (root / 'migration_v7_catalog_trash.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(trash_migration)
                await raw.execute("UPDATE catalog_customers SET deleted_at=now() WHERE id <> $1", customer)
                windows_migration = (root / 'migration_v17_windows_duplicate_names.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(windows_migration)
                names = await raw.fetch('SELECT identification_name FROM catalog_customers ORDER BY identification_name')
                self.assertEqual([r[0] for r in names], ['China-Legacy', 'China-Legacy (2)'])
                self.assertEqual(await raw.fetchval('SELECT customer_id FROM catalog_projects'), customer)
                self.assertIsNone(await raw.fetchval("SELECT to_regclass($1)", schema + '.catalog_customer_names'))
                before = await raw.fetch('SELECT id, identification_name, revision FROM catalog_customers ORDER BY id')
                await raw.execute(windows_migration)
                self.assertEqual(before, await raw.fetch('SELECT id, identification_name, revision FROM catalog_customers ORDER BY id'))
                # Re-running migration must not fill gaps or rename survivors.
                await raw.execute('DELETE FROM catalog_customers WHERE id <> $1', customer)
                before = await raw.fetch('SELECT id, identification_name, revision FROM catalog_customers ORDER BY id')
                await raw.execute(windows_migration)
                self.assertEqual(before, await raw.fetch('SELECT id, identification_name, revision FROM catalog_customers ORDER BY id'))
                product_migration = (root / 'migration_v18_product_duplicate_names.sql').read_text().replace('BEGIN;', '').replace('COMMIT;', '')
                await raw.execute(product_migration)
                await raw.execute(product_migration)
                self.assertEqual(await raw.fetchval('SELECT identification_name FROM catalog_products'), 'A long custom product type-Legacy')
            finally:
                await transaction.rollback()
        await engine.dispose()
