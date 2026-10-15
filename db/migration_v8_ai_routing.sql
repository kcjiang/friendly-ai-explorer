BEGIN;
CREATE TABLE IF NOT EXISTS ai_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    protocol varchar(30) NOT NULL CHECK (protocol IN ('gemini', 'openai')),
    base_url varchar(1000) NOT NULL,
    model varchar(200) NOT NULL,
    api_key_encrypted text,
    use_env_key boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT true,
    timeout_seconds integer NOT NULL DEFAULT 90 CHECK (timeout_seconds BETWEEN 5 AND 300),
    max_output_tokens integer NOT NULL DEFAULT 2048 CHECK (max_output_tokens BETWEEN 16 AND 65536),
    max_concurrency integer NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 32),
    last_test_at timestamptz,
    last_test_ok boolean,
    last_test_message text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_providers (id, name, protocol, base_url, model, use_env_key, max_concurrency)
VALUES ('00000000-0000-0000-0000-000000000001', '原有 Gemini（环境变量密钥）', 'gemini',
        'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-flash', true, 4)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_routes (
    task varchar(40) PRIMARY KEY CHECK (task IN ('default', 'todo', 'ticket_analysis', 'email_analysis', 'rag_chat')),
    provider_id uuid REFERENCES ai_providers(id),
    fallback_provider_id uuid REFERENCES ai_providers(id),
    timeout_seconds integer CHECK (timeout_seconds BETWEEN 5 AND 300),
    max_output_tokens integer CHECK (max_output_tokens BETWEEN 16 AND 65536),
    CHECK (task <> 'default' OR provider_id IS NOT NULL),
    CHECK (provider_id IS NULL OR fallback_provider_id IS NULL OR provider_id <> fallback_provider_id)
);
INSERT INTO ai_routes (task, provider_id) VALUES
    ('default', '00000000-0000-0000-0000-000000000001'),
    ('todo', NULL), ('ticket_analysis', NULL), ('email_analysis', NULL), ('rag_chat', NULL)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ai_call_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task varchar(40) NOT NULL,
    provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
    provider_name varchar(100) NOT NULL,
    model varchar(200) NOT NULL,
    success boolean NOT NULL,
    fallback boolean NOT NULL DEFAULT false,
    elapsed_ms integer NOT NULL,
    input_tokens integer,
    output_tokens integer,
    error varchar(300),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_call_logs_created_idx ON ai_call_logs(created_at DESC);
COMMIT;
