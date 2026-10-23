"""Validate the fresh-deployment schema against the application's actual metadata."""

import unittest
from sqlalchemy import inspect, text
from app.database import Base, engine
from app.main import app  # Registers the models used by every mounted route.


class DatabaseInitTests(unittest.IsolatedAsyncioTestCase):
    async def test_schema_matches_models_without_migration_tables(self):
        async with engine.connect() as connection:

            def check(sync):
                db = inspect(sync)
                tables = set(db.get_table_names())
                # These tables are intentionally accessed through SQL rather than ORM models.
                self.assertEqual(
                    tables,
                    set(Base.metadata.tables)
                    | {"audit_logs", "system_configs", "ticket_project_counters"},
                )
                self.assertFalse(
                    any(t.startswith("wb_") or "migration" in t for t in tables)
                )
                for name, table in Base.metadata.tables.items():
                    self.assertEqual(
                        {c["name"] for c in db.get_columns(name)},
                        set(table.columns.keys()),
                        name,
                    )

            await connection.run_sync(check)
            method = await connection.scalar(
                text(
                    "SELECT am.amname FROM pg_class c JOIN pg_am am ON am.oid=c.relam WHERE c.relname='document_chunks_embedding_idx'"
                )
            )
            self.assertEqual(method, "hnsw")
        await engine.dispose()
