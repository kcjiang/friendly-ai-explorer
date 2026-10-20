BEGIN;
SELECT pg_advisory_xact_lock(73130913);
LOCK TABLE catalog_customers IN ACCESS EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS catalog_schema_migrations (version INTEGER PRIMARY KEY);
DO $$
DECLARE r RECORD; base TEXT; candidate TEXT; number INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM catalog_schema_migrations WHERE version = 17) THEN
        CREATE TEMP TABLE customer_name_mapping (id UUID PRIMARY KEY, name VARCHAR(340) UNIQUE) ON COMMIT DROP;
        FOR r IN SELECT id, country_name, company_name FROM catalog_customers ORDER BY created_at, id LOOP
            base := r.country_name || '-' || r.company_name;
            candidate := base;
            number := 2;
            WHILE EXISTS (SELECT 1 FROM customer_name_mapping WHERE name = candidate) LOOP
                candidate := base || ' (' || number || ')';
                number := number + 1;
            END LOOP;
            INSERT INTO customer_name_mapping VALUES (r.id, candidate);
        END LOOP;
        -- Replace all names atomically; avoid intermediate collisions during renaming.
        DROP INDEX IF EXISTS catalog_customers_identification_idx;
        UPDATE catalog_customers c SET identification_name = m.name, revision = c.revision + 1
        FROM customer_name_mapping m WHERE c.id = m.id AND c.identification_name IS DISTINCT FROM m.name;
        CREATE UNIQUE INDEX catalog_customers_identification_idx ON catalog_customers(identification_name);
        INSERT INTO catalog_schema_migrations VALUES (17);
    END IF;
END $$;
-- Naming uses current records, not a permanent reservation ledger.
DROP TABLE IF EXISTS catalog_customer_names;
DROP TABLE IF EXISTS catalog_customer_name_counters;
COMMIT;
