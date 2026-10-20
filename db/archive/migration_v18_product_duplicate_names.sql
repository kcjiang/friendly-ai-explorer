BEGIN;
SELECT pg_advisory_xact_lock(73130913);
LOCK TABLE catalog_products IN ACCESS EXCLUSIVE MODE;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS identification_name VARCHAR(340);
DO $$
DECLARE r RECORD; base TEXT; candidate TEXT; number INTEGER;
BEGIN
    FOR r IN SELECT id, type, model FROM catalog_products WHERE identification_name IS NULL ORDER BY created_at, id LOOP
        base := r.type || '-' || r.model;
        candidate := base;
        number := 2;
        WHILE EXISTS (SELECT 1 FROM catalog_products WHERE identification_name = candidate) LOOP
            candidate := base || ' (' || number || ')';
            number := number + 1;
        END LOOP;
        UPDATE catalog_products SET identification_name = candidate WHERE id = r.id;
    END LOOP;
END $$;
ALTER TABLE catalog_products ALTER COLUMN identification_name SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_identification_idx ON catalog_products(identification_name);
COMMIT;
