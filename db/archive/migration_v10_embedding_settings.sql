BEGIN;
CREATE TABLE IF NOT EXISTS embedding_settings (
    id integer PRIMARY KEY CHECK (id = 1),
    config jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO embedding_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
