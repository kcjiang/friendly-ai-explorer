BEGIN;
ALTER TABLE catalog_customers ADD COLUMN IF NOT EXISTS business JSONB NOT NULL DEFAULT '[]';
ALTER TABLE catalog_customers ADD COLUMN IF NOT EXISTS identification_name VARCHAR(340);
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS fingerprint TEXT NOT NULL DEFAULT '';
-- Allocation history survives permanent deletion to prevent name reuse.
CREATE TABLE IF NOT EXISTS catalog_customer_name_counters (
    base_name VARCHAR(310) PRIMARY KEY,
    next_suffix INTEGER NOT NULL CHECK (next_suffix >= 1)
);
CREATE TABLE IF NOT EXISTS catalog_customer_names (
    identification_name VARCHAR(340) PRIMARY KEY
);
DO $$
DECLARE r RECORD; base TEXT; candidate TEXT; suffix INTEGER;
BEGIN
    FOR r IN SELECT * FROM catalog_customers WHERE identification_name IS NULL ORDER BY created_at, id LOOP
        base := r.country_name || '-' || r.company_name;
        candidate := base;
        suffix := 0;
        WHILE EXISTS (SELECT 1 FROM catalog_customer_names WHERE identification_name = candidate)
           OR EXISTS (SELECT 1 FROM catalog_customers WHERE identification_name = candidate) LOOP
            suffix := suffix + 1;
            candidate := base || '-' || suffix;
        END LOOP;
        INSERT INTO catalog_customer_names VALUES (candidate) ON CONFLICT DO NOTHING;
        INSERT INTO catalog_customer_name_counters VALUES (base, suffix + 1)
            ON CONFLICT (base_name) DO UPDATE SET next_suffix = GREATEST(catalog_customer_name_counters.next_suffix, EXCLUDED.next_suffix);
        UPDATE catalog_customers SET identification_name = candidate WHERE id = r.id;
    END LOOP;
END $$;
ALTER TABLE catalog_customers ALTER COLUMN identification_name SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS catalog_customers_identification_idx ON catalog_customers(identification_name);
ALTER TABLE catalog_customers DROP COLUMN IF EXISTS city_id;
ALTER TABLE catalog_customers DROP COLUMN IF EXISTS city_name;
ALTER TABLE catalog_projects ADD COLUMN IF NOT EXISTS start_date DATE;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'catalog_projects' AND column_name = 'start_month') THEN
        EXECUTE 'UPDATE catalog_projects SET start_date = (start_month || ''-01'')::date WHERE start_date IS NULL';
    END IF;
END $$;
ALTER TABLE catalog_projects ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE catalog_projects DROP COLUMN IF EXISTS start_month;
COMMIT;
