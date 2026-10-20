BEGIN;
-- Preserve tool names from every customer, including recently deleted records.
INSERT INTO catalog_options(category, value)
SELECT DISTINCT 'contact_method', method->>'type'
FROM catalog_customers
CROSS JOIN LATERAL jsonb_array_elements(contacts) AS contact
CROSS JOIN LATERAL jsonb_array_elements(contact->'methods') AS method
WHERE method->>'type' IS NOT NULL AND method->>'type' <> ''
ON CONFLICT DO NOTHING;
COMMIT;
