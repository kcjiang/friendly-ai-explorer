BEGIN;
ALTER TABLE ai_providers
    ADD COLUMN IF NOT EXISTS thinking_mode varchar(10) NOT NULL DEFAULT 'auto' CHECK (thinking_mode IN ('auto', 'off', 'on')),
    ADD COLUMN IF NOT EXISTS structured_output varchar(10) NOT NULL DEFAULT 'auto' CHECK (structured_output IN ('auto', 'schema', 'object', 'off')),
    ADD COLUMN IF NOT EXISTS temperature double precision CHECK (temperature BETWEEN 0 AND 2),
    ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 1 CHECK (retry_count BETWEEN 0 AND 2);
ALTER TABLE ai_call_logs
    ADD COLUMN IF NOT EXISTS request_id varchar(64),
    ADD COLUMN IF NOT EXISTS diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS ai_call_logs_request_idx ON ai_call_logs(request_id);
COMMIT;
