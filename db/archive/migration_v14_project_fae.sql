BEGIN;
ALTER TABLE catalog_projects
    ADD COLUMN IF NOT EXISTS fae_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_catalog_projects_fae ON catalog_projects(fae_id);
COMMIT;
