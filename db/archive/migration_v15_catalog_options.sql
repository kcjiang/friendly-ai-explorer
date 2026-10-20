BEGIN;
ALTER TABLE catalog_customers DROP CONSTRAINT IF EXISTS catalog_customers_level_check;
ALTER TABLE catalog_products DROP CONSTRAINT IF EXISTS catalog_products_type_check;
ALTER TABLE catalog_projects DROP CONSTRAINT IF EXISTS catalog_projects_stage_check;
ALTER TABLE catalog_customers ALTER COLUMN level TYPE VARCHAR(100);
ALTER TABLE catalog_products ALTER COLUMN type TYPE VARCHAR(100);
ALTER TABLE catalog_projects ALTER COLUMN stage TYPE VARCHAR(100);
DO $$ BEGIN
IF to_regclass(format('%I.catalog_options', current_schema())) IS NULL THEN
CREATE TABLE catalog_options (
    category VARCHAR(30) NOT NULL,
    value VARCHAR(100) NOT NULL,
    PRIMARY KEY (category, value)
);
INSERT INTO catalog_options(category, value) VALUES
 ('customer_level','KA'),('customer_level','LA'),('customer_level','SMB'),
 ('product_type','OTT'),('product_type','IPC'),('product_type','NetCom'),
 ('project_stage','EV'),('project_stage','EVT'),('project_stage','DVT'),
 ('project_stage','PVT'),('project_stage','MR'),('project_stage','MP')
ON CONFLICT DO NOTHING;
END IF;
END $$;
INSERT INTO catalog_options(category, value)
 SELECT 'customer_level', level FROM catalog_customers
 UNION SELECT 'product_type', type FROM catalog_products
 UNION SELECT 'project_pm', pm FROM catalog_projects
 UNION SELECT 'project_stage', stage FROM catalog_projects
ON CONFLICT DO NOTHING;
COMMIT;
