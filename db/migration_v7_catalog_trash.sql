BEGIN;
ALTER TABLE catalog_customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
ALTER TABLE catalog_projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS catalog_customers_deleted_idx ON catalog_customers(deleted_at);
CREATE INDEX IF NOT EXISTS catalog_products_deleted_idx ON catalog_products(deleted_at);
CREATE INDEX IF NOT EXISTS catalog_projects_deleted_idx ON catalog_projects(deleted_at);
COMMIT;
