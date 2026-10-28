-- Friendly AI Explorer: fresh database initialization only.
-- Final schema and bootstrap configuration; no historical data or migrations.
BEGIN;
CREATE EXTENSION vector;


CREATE TYPE doc_visibility AS ENUM ('public', 'private');


CREATE TYPE user_role AS ENUM ('developer', 'leader', 'engineer');

CREATE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


CREATE SEQUENCE ticket_seq START WITH 1;

CREATE TABLE ai_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    vendor character varying(30) DEFAULT 'other'::character varying NOT NULL,
    auth_required boolean DEFAULT true NOT NULL,
    token_parameter character varying(30) DEFAULT 'max_tokens'::character varying NOT NULL,
    capability_checks jsonb DEFAULT '{}'::jsonb NOT NULL,
    protocol character varying(30) NOT NULL,
    base_url character varying(1000) NOT NULL,
    model character varying(200) NOT NULL,
    api_key_encrypted text,
    enabled boolean DEFAULT true NOT NULL,
    timeout_seconds integer DEFAULT 90 NOT NULL,
    max_output_tokens integer DEFAULT 2048 NOT NULL,
    max_concurrency integer DEFAULT 1 NOT NULL,
    last_test_at timestamp with time zone,
    last_test_ok boolean,
    last_test_message text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    thinking_mode character varying(10) DEFAULT 'auto'::character varying NOT NULL,
    structured_output character varying(10) DEFAULT 'auto'::character varying NOT NULL,
    temperature double precision,
    retry_count integer DEFAULT 1 NOT NULL,
    CHECK (((max_concurrency >= 1) AND (max_concurrency <= 32))),
    CHECK (((max_output_tokens >= 16) AND (max_output_tokens <= 65536))),
    CHECK (((protocol)::text = ANY (ARRAY[('gemini'::character varying)::text, ('openai'::character varying)::text, ('responses'::character varying)::text]))),
    CHECK (((retry_count >= 0) AND (retry_count <= 2))),
    CHECK (((structured_output)::text = ANY (ARRAY[('auto'::character varying)::text, ('schema'::character varying)::text, ('object'::character varying)::text, ('off'::character varying)::text]))),
    CHECK (((temperature >= (0)::double precision) AND (temperature <= (2)::double precision))),
    CHECK (((thinking_mode)::text = ANY (ARRAY[('auto'::character varying)::text, ('off'::character varying)::text, ('on'::character varying)::text]))),
    CHECK (((timeout_seconds >= 5) AND (timeout_seconds <= 300))),
    PRIMARY KEY (id)
);

CREATE TABLE catalog_options (
    category character varying(30) NOT NULL,
    value character varying(100) NOT NULL,
    PRIMARY KEY (category, value)
);

CREATE TABLE embedding_profiles (
    id uuid NOT NULL,
    name character varying(100) NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role user_role DEFAULT 'engineer'::user_role NOT NULL,
    avatar_url character varying(500),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE (email),
    PRIMARY KEY (id)
);

CREATE TABLE ai_call_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task character varying(40) NOT NULL,
    provider_id uuid,
    provider_name character varying(100) NOT NULL,
    model character varying(200) NOT NULL,
    success boolean NOT NULL,
    fallback boolean DEFAULT false NOT NULL,
    elapsed_ms integer NOT NULL,
    input_tokens integer,
    output_tokens integer,
    error character varying(300),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id character varying(64),
    diagnostics jsonb DEFAULT '{}'::jsonb NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
);

CREATE TABLE ai_routes (
    task character varying(40) NOT NULL,
    provider_id uuid,
    fallback_provider_id uuid,
    timeout_seconds integer,
    max_output_tokens integer,
    CHECK (((max_output_tokens >= 16) AND (max_output_tokens <= 65536))),
    CHECK (((provider_id IS NULL) OR (fallback_provider_id IS NULL) OR (provider_id <> fallback_provider_id))),
    CHECK (task IN ('default', 'todo', 'ticket_analysis', 'rag_chat')),
    CHECK (((timeout_seconds >= 5) AND (timeout_seconds <= 300))),
    PRIMARY KEY (task),
    FOREIGN KEY (fallback_provider_id) REFERENCES ai_providers(id),
    FOREIGN KEY (provider_id) REFERENCES ai_providers(id)
);

CREATE TABLE audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    resource_type character varying(100),
    resource_id uuid,
    details jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE catalog_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name character varying(200) NOT NULL,
    country_code character varying(2) NOT NULL,
    country_name character varying(100) NOT NULL,
    level character varying(100) NOT NULL,
    contacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    business jsonb DEFAULT '[]'::jsonb NOT NULL,
    identification_name character varying(340) NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (deleted_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE catalog_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(100) NOT NULL,
    model character varying(200) NOT NULL,
    chipset character varying(200) NOT NULL,
    system character varying(200) NOT NULL,
    repository_url character varying(2000) DEFAULT ''::character varying NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    fingerprint text DEFAULT ''::text NOT NULL,
    identification_name character varying(340) NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (deleted_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(500) NOT NULL,
    content text,
    content_type character varying(50) DEFAULT 'markdown'::character varying,
    file_url character varying(500),
    file_original_name character varying(255),
    visibility doc_visibility DEFAULT 'public'::doc_visibility,
    author_id uuid NOT NULL,
    is_published boolean DEFAULT false,
    tags text[],
    view_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (id),
    FOREIGN KEY (author_id) REFERENCES users(id)
);


CREATE TABLE embedding_settings (
    id integer NOT NULL,
    active_profile_id uuid,
    CHECK ((id = 1)),
    PRIMARY KEY (id),
    FOREIGN KEY (active_profile_id) REFERENCES embedding_profiles(id)
);

CREATE TABLE preset_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    command text NOT NULL,
    group_name character varying(100) DEFAULT 'General'::character varying,
    device_type character varying(20) NOT NULL,
    is_public boolean DEFAULT false,
    is_danger boolean DEFAULT false,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CHECK (((device_type)::text = ANY (ARRAY[('adb'::character varying)::text, ('serial'::character varying)::text]))),
    PRIMARY KEY (id),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE system_configs (
    key character varying(100) NOT NULL,
    value text,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (key),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);


CREATE TABLE uploaded_logs (
    storage_entry_id uuid,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_type character varying(20) NOT NULL,
    filename character varying(500) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_size bigint DEFAULT 0,
    line_count integer DEFAULT 0,
    description character varying(500),
    created_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (id),
    CHECK (((device_type)::text = ANY (ARRAY[('adb'::character varying)::text, ('serial'::character varying)::text]))),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workbench_accounts (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    platform character varying(20) NOT NULL,
    base_url character varying(500) NOT NULL,
    username character varying(255) NOT NULL,
    password_encrypted text NOT NULL,
    position integer NOT NULL,
    enabled boolean NOT NULL,
    status character varying(20) NOT NULL,
    error text,
    last_run_at timestamp with time zone,
    project_id uuid,
    mail_folder_id uuid,
    deleted_at timestamp with time zone,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workbench_automations (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    kind character varying(20) NOT NULL,
    position integer NOT NULL,
    steps jsonb NOT NULL,
    deleted_at timestamp with time zone,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workbench_debug_events (
    id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    user_id uuid NOT NULL,
    output text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workbench_mailboxes (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    address character varying(320) NOT NULL,
    username character varying(320) NOT NULL,
    password_encrypted text NOT NULL,
    imap_host character varying(255) NOT NULL,
    imap_port integer NOT NULL,
    imap_security character varying(16) NOT NULL,
    smtp_host character varying(255) NOT NULL,
    smtp_port integer NOT NULL,
    smtp_security character varying(16) NOT NULL,
    status character varying(24) NOT NULL,
    error text,
    last_sync_at timestamp with time zone,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workbench_preferences (
    user_id uuid NOT NULL,
    schedule jsonb NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_automation_id uuid,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workbench_checks (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin varchar(16) NOT NULL CHECK (origin IN ('manual', 'scheduled')),
    output_locale varchar(35) NOT NULL DEFAULT 'en',
    status varchar(16) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    queued_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    error varchar(1000)
);
CREATE INDEX ix_workbench_checks_pending ON workbench_checks (id) WHERE status IN ('queued', 'running');
CREATE INDEX ix_workbench_checks_finished ON workbench_checks (finished_at);
CREATE INDEX ix_workbench_checks_user ON workbench_checks (user_id, id);
CREATE UNIQUE INDEX uq_workbench_checks_active ON workbench_checks (user_id, origin) WHERE status IN ('queued', 'running');

CREATE TABLE catalog_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number character varying(100) NOT NULL,
    pm character varying(100) NOT NULL,
    stage character varying(100) NOT NULL,
    customer_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    start_date date NOT NULL,
    fae_id uuid,
    PRIMARY KEY (id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (customer_id) REFERENCES catalog_customers(id),
    FOREIGN KEY (deleted_by) REFERENCES users(id),
    FOREIGN KEY (fae_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES catalog_products(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE document_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding vector(768),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);


CREATE TABLE workbench_mail_deliveries (
    id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    status character varying(24) NOT NULL,
    result jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (mailbox_id) REFERENCES workbench_mailboxes(id) ON DELETE CASCADE
);

CREATE TABLE workbench_mail_folders (
    id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    path character varying(1000) NOT NULL,
    delimiter character varying(8) NOT NULL,
    flags jsonb NOT NULL,
    selectable boolean NOT NULL,
    present boolean NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (mailbox_id, path),
    FOREIGN KEY (mailbox_id) REFERENCES workbench_mailboxes(id) ON DELETE CASCADE
);

CREATE TABLE workbench_messages (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    account_id uuid NOT NULL,
    payload jsonb NOT NULL,
    note text NOT NULL,
    is_read boolean NOT NULL,
    submitted boolean NOT NULL,
    received_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    dismissed boolean DEFAULT false NOT NULL,
    source_key character varying(300),
    revision integer DEFAULT 1 NOT NULL,
    project_id uuid,
    resource_updated_at timestamp with time zone,
    resource_source jsonb,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES workbench_accounts(id) ON DELETE CASCADE
);


CREATE TABLE ticket_project_counters (
    project_id uuid NOT NULL,
    last_value bigint NOT NULL,
    PRIMARY KEY (project_id),
    CHECK ((last_value > 0)),
    FOREIGN KEY (project_id) REFERENCES catalog_projects(id)
);

CREATE TABLE tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_no character varying(50) NOT NULL,
    title character varying(500) NOT NULL,
    description text,
    customer_name character varying(200),
    customer_contact character varying(200),
    product_name character varying(200),
    firmware_version character varying(100),
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'major'::character varying NOT NULL,
    assignee_id uuid,
    creator_id uuid NOT NULL,
    ai_analysis text,
    ai_suggestions text,
    tags text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    system_seq bigint NOT NULL,
    project_id uuid,
    project_seq bigint,
    source character varying(100) DEFAULT 'Email'::character varying NOT NULL,
    source_number character varying(200) DEFAULT ''::character varying NOT NULL,
    source_url character varying(2000) DEFAULT ''::character varying NOT NULL,
    raw_report text DEFAULT ''::text NOT NULL,
    tapd_created boolean DEFAULT false NOT NULL,
    tapd_url character varying(2000) DEFAULT ''::character varying NOT NULL,
    status_note character varying(500) DEFAULT ''::character varying NOT NULL,
    next_plan text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    updated_by uuid NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    PRIMARY KEY (id),
    CHECK (((priority)::text = ANY (ARRAY[('trivial'::character varying)::text, ('critical'::character varying)::text, ('major'::character varying)::text]))),
    UNIQUE (project_id, project_seq),
    UNIQUE (system_seq),
    UNIQUE (ticket_no),
    CHECK ((((project_id IS NULL) AND (project_seq IS NULL)) OR ((project_id IS NOT NULL) AND (project_seq > 0)))),
    CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('reproducing'::character varying)::text, ('in_progress'::character varying)::text, ('verifying'::character varying)::text, ('pending'::character varying)::text, ('resolved'::character varying)::text]))),
    FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (creator_id) REFERENCES users(id),
    FOREIGN KEY (project_id) REFERENCES catalog_projects(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE workbench_mail_rules (
    id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    sender character varying(320) NOT NULL,
    keywords jsonb NOT NULL,
    enabled boolean NOT NULL,
    position integer NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (mailbox_id) REFERENCES workbench_mailboxes(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES workbench_mail_folders(id) ON DELETE CASCADE
);


CREATE TABLE ticket_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    is_internal boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (id),
    FOREIGN KEY (author_id) REFERENCES users(id),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE TABLE workbench_jobs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    automation_id uuid NOT NULL,
    message_id uuid,
    snapshot jsonb NOT NULL,
    steps jsonb NOT NULL,
    status character varying(20) NOT NULL,
    step_index integer NOT NULL,
    logs jsonb NOT NULL,
    error text,
    ticket_id uuid,
    queued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    input_revision integer DEFAULT 1 NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (automation_id) REFERENCES workbench_automations(id) ON DELETE RESTRICT,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
    FOREIGN KEY (message_id) REFERENCES workbench_messages(id) ON DELETE CASCADE
);

CREATE TABLE workbench_emails (
    id uuid NOT NULL,
    mailbox_id uuid NOT NULL,
    source_key character varying(64) NOT NULL,
    message_id text NOT NULL,
    subject text NOT NULL,
    sender text NOT NULL,
    recipients text NOT NULL,
    cc text NOT NULL,
    body_text text NOT NULL,
    body_html text NOT NULL,
    raw bytea NOT NULL,
    received_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    is_read boolean NOT NULL,
    rule_id uuid,
    PRIMARY KEY (id),
    UNIQUE (mailbox_id, source_key),
    FOREIGN KEY (mailbox_id) REFERENCES workbench_mailboxes(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES workbench_mail_rules(id) ON DELETE SET NULL
);

CREATE TABLE workbench_mail_locations (
    id uuid NOT NULL,
    mail_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    validity character varying(64) NOT NULL,
    uid character varying(32) NOT NULL,
    is_read boolean NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (folder_id, validity, uid),
    FOREIGN KEY (mail_id) REFERENCES workbench_emails(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES workbench_mail_folders(id) ON DELETE CASCADE
);

CREATE TABLE workbench_message_emails (
    id uuid NOT NULL,
    message_id uuid NOT NULL,
    mail_id uuid NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (message_id, mail_id),
    FOREIGN KEY (message_id) REFERENCES workbench_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (mail_id) REFERENCES workbench_emails(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX ai_call_logs_created_idx ON ai_call_logs USING btree (created_at DESC);
CREATE INDEX ai_call_logs_request_idx ON ai_call_logs USING btree (request_id);
CREATE UNIQUE INDEX catalog_customers_identification_idx ON catalog_customers USING btree (identification_name);
CREATE INDEX catalog_customers_deleted_idx ON catalog_customers USING btree (deleted_at);
CREATE INDEX catalog_customers_updated_idx ON catalog_customers USING btree (updated_at);
CREATE INDEX catalog_products_updated_idx ON catalog_products USING btree (updated_at);
CREATE UNIQUE INDEX catalog_products_identification_idx ON catalog_products USING btree (identification_name);
CREATE INDEX catalog_products_deleted_idx ON catalog_products USING btree (deleted_at);
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX ix_workbench_accounts_user_id ON workbench_accounts USING btree (user_id);
CREATE INDEX ix_workbench_automations_user_id ON workbench_automations USING btree (user_id);
CREATE INDEX ix_workbench_debug_events_user_id ON workbench_debug_events USING btree (user_id);
CREATE INDEX ix_workbench_debug_events_user_cursor ON workbench_debug_events USING btree (user_id, id);
CREATE INDEX ix_workbench_debug_events_expires_at ON workbench_debug_events USING btree (expires_at);
CREATE INDEX ix_workbench_mailboxes_user_id ON workbench_mailboxes USING btree (user_id);
CREATE INDEX ix_workbench_preferences_next_run_at ON workbench_preferences USING btree (next_run_at);
CREATE INDEX idx_catalog_projects_fae ON catalog_projects USING btree (fae_id);
CREATE INDEX catalog_projects_deleted_idx ON catalog_projects USING btree (deleted_at);
CREATE INDEX catalog_projects_updated_idx ON catalog_projects USING btree (updated_at);
CREATE INDEX catalog_projects_customer_idx ON catalog_projects USING btree (customer_id);
CREATE INDEX catalog_projects_product_idx ON catalog_projects USING btree (product_id);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ix_workbench_mail_deliveries_expires_at ON workbench_mail_deliveries USING btree (expires_at);
CREATE INDEX ix_workbench_mail_deliveries_mailbox_id ON workbench_mail_deliveries USING btree (mailbox_id);
CREATE INDEX ix_workbench_mail_folders_mailbox_id ON workbench_mail_folders USING btree (mailbox_id);
CREATE INDEX ix_workbench_messages_expires_at ON workbench_messages USING btree (expires_at);
CREATE INDEX ix_workbench_messages_account_id ON workbench_messages USING btree (account_id);
CREATE INDEX ix_workbench_messages_account_received ON workbench_messages USING btree (account_id, received_at, id);
CREATE INDEX ix_workbench_messages_received_at ON workbench_messages USING btree (received_at);
CREATE UNIQUE INDEX workbench_messages_source ON workbench_messages USING btree (account_id, source_key) WHERE (source_key IS NOT NULL);
CREATE INDEX ix_workbench_messages_user_id ON workbench_messages USING btree (user_id);
CREATE INDEX tickets_assignee_status_idx ON tickets USING btree (assignee_id, status);
CREATE INDEX tickets_updated_idx ON tickets USING btree (updated_at DESC);
CREATE TRIGGER trg_tickets_updated_at BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX ix_workbench_mail_rules_mailbox_id ON workbench_mail_rules USING btree (mailbox_id);
CREATE INDEX ix_workbench_jobs_expires_at ON workbench_jobs USING btree (expires_at);
CREATE INDEX ix_workbench_jobs_queued_at ON workbench_jobs USING btree (queued_at);
CREATE INDEX ix_workbench_jobs_automation_id ON workbench_jobs USING btree (automation_id);
CREATE INDEX ix_workbench_jobs_status ON workbench_jobs USING btree (status);
CREATE INDEX ix_workbench_jobs_message_id ON workbench_jobs USING btree (message_id);
CREATE INDEX ix_workbench_jobs_user_id ON workbench_jobs USING btree (user_id);
CREATE INDEX ix_workbench_emails_expires_at ON workbench_emails USING btree (expires_at);
CREATE INDEX ix_workbench_emails_received_at ON workbench_emails USING btree (received_at);
CREATE INDEX ix_workbench_emails_mailbox_id ON workbench_emails USING btree (mailbox_id);
CREATE INDEX ix_workbench_mail_locations_mail_id ON workbench_mail_locations USING btree (mail_id);
CREATE INDEX ix_workbench_mail_locations_folder_id ON workbench_mail_locations USING btree (folder_id);
CREATE INDEX ix_workbench_message_emails_message_id ON workbench_message_emails USING btree (message_id);
CREATE INDEX ix_workbench_message_emails_mail_id ON workbench_message_emails USING btree (mail_id);

-- Shared file storage, immutable ticket attachments and recoverable uploads.
CREATE TABLE storage_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space varchar(80) NOT NULL,
 path text NOT NULL, is_dir boolean NOT NULL DEFAULT false, size bigint NOT NULL DEFAULT 0 CHECK(size>=0),
 ticket_id uuid REFERENCES tickets(id) ON DELETE RESTRICT,
 media_type varchar(100), thumbnail_size bigint NOT NULL DEFAULT 0 CHECK(thumbnail_size>=0),
 sha256 varchar(64), creator_id uuid REFERENCES users(id) ON DELETE SET NULL,
 document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
 trash_id uuid, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX storage_active_path ON storage_entries(space, path) WHERE trash_id IS NULL;
CREATE INDEX storage_trash ON storage_entries(trash_id);
CREATE TABLE storage_shares (
 entry_id uuid REFERENCES storage_entries(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(entry_id, user_id)
);
CREATE TABLE storage_settings (
 id integer PRIMARY KEY CHECK(id=1), total_bytes bigint NOT NULL DEFAULT 107374182400 CHECK(total_bytes>=0),
 default_personal_bytes bigint NOT NULL DEFAULT 5368709120 CHECK(default_personal_bytes>=0),
 upload_limits jsonb NOT NULL DEFAULT '{}',
 user_quotas jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE file_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 space varchar(80) NOT NULL, path text NOT NULL, action varchar(40) NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_operation_entry ON file_operations(entry_id, created_at);
ALTER TABLE uploaded_logs ADD CONSTRAINT uploaded_logs_storage_entry_fk FOREIGN KEY(storage_entry_id) REFERENCES storage_entries(id) ON DELETE SET NULL;
CREATE INDEX storage_ticket ON storage_entries(ticket_id);
CREATE INDEX storage_my_attachments ON storage_entries(creator_id, created_at DESC) WHERE ticket_id IS NOT NULL AND trash_id IS NULL;
CREATE INDEX storage_space_path ON storage_entries(space, path);
CREATE TABLE upload_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 purpose varchar(30) NOT NULL, space varchar(80) NOT NULL, parent text NOT NULL DEFAULT '',
 filename varchar(255) NOT NULL, size bigint NOT NULL CHECK(size>=0), fingerprint varchar(64) NOT NULL,
 chunk_size integer NOT NULL CHECK(chunk_size>0), parts jsonb NOT NULL DEFAULT '[]',
 reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0), status varchar(20) NOT NULL DEFAULT 'active',
 conflict varchar(10) NOT NULL DEFAULT 'skip', entry_id uuid REFERENCES storage_entries(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, context jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX upload_owner_status ON upload_tasks(user_id,status);
CREATE INDEX upload_expiry ON upload_tasks(expires_at);
CREATE TABLE file_garbage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), path text NOT NULL, size bigint NOT NULL DEFAULT 0,
 charged_user_id uuid, pooled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

-- Bootstrap configuration only; business and provider tables start empty.
INSERT INTO storage_settings(id) VALUES(1);

INSERT INTO ai_routes (task, provider_id, fallback_provider_id, timeout_seconds, max_output_tokens) VALUES
    ('default', NULL, NULL, NULL, NULL),
    ('todo', NULL, NULL, NULL, NULL),
    ('ticket_analysis', NULL, NULL, NULL, NULL),
    ('rag_chat', NULL, NULL, NULL, NULL);


INSERT INTO catalog_options (category, value) VALUES
    ('customer_level', 'KA'),
    ('customer_level', 'LA'),
    ('customer_level', 'SMB'),
    ('product_type', 'OTT'),
    ('product_type', 'IPC'),
    ('product_type', 'NetCom'),
    ('project_stage', 'EV'),
    ('project_stage', 'EVT'),
    ('project_stage', 'DVT'),
    ('project_stage', 'PVT'),
    ('project_stage', 'MR'),
    ('project_stage', 'MP');


INSERT INTO embedding_settings (id) VALUES (1);
INSERT INTO preset_commands (id, name, command, group_name, device_type, is_public, is_danger, owner_id) VALUES
    ('a49f2f54-ff7c-44de-a65e-f3b1f9edd9e5', 'Device model', 'getprop ro.product.model', 'Device information', 'adb', 't', 'f', NULL),
    ('3e42f166-838c-4887-8eb6-6fb589a7a1fd', 'System version', 'getprop ro.build.version.release', 'Device information', 'adb', 't', 'f', NULL),
    ('3f3e8cbb-d72d-40de-b3f7-a58695fa49c8', 'All properties', 'getprop', 'Device information', 'adb', 't', 'f', NULL),
    ('6dd54701-e2e5-4beb-ab9e-fc05d02ce017', 'Screen resolution', 'wm size', 'Device information', 'adb', 't', 'f', NULL),
    ('45d1852f-3627-415d-8f44-637dd9f5cb55', 'Disk space', 'df -h', 'Device information', 'adb', 't', 'f', NULL),
    ('684249e3-d113-471d-b412-06cedfbe2682', 'Memory information', 'free -h', 'Device information', 'adb', 't', 'f', NULL),
    ('bfba44e9-9a06-49ef-ac6c-e20e55270b90', 'Battery status', 'dumpsys battery', 'Device information', 'adb', 't', 'f', NULL),
    ('5fe88648-bbd5-4b6d-a59d-345c76d6e17a', 'Network interfaces', 'ip addr show', 'Device information', 'adb', 't', 'f', NULL),
    ('fa5e2f70-2da5-4aff-b190-e6ed4e3efa83', 'Third-party apps', 'pm list packages -3', 'Application management', 'adb', 't', 'f', NULL),
    ('74bf2f9d-cbc2-458f-a02a-e1689c2b26d0', 'Foreground app', 'dumpsys activity | grep -i resumed', 'Application management', 'adb', 't', 'f', NULL),
    ('4430ec40-6748-4ace-b885-648dd6584f8a', 'Clear logs', 'logcat -c', 'Application management', 'adb', 't', 'f', NULL),
    ('aae71d39-b36a-4f02-bbce-45f2c033ea23', 'Reboot', 'reboot', 'Control', 'adb', 't', 't', NULL),
    ('49e72196-9810-4210-a410-41ae3b07d17c', 'Reboot Recovery', 'reboot recovery', 'Control', 'adb', 't', 't', NULL),
    ('c225708a-79aa-46d2-bae2-e3c56f569b07', 'Reboot Bootloader', 'reboot bootloader', 'Control', 'adb', 't', 't', NULL),
    ('0aa814fe-5e78-4086-ac05-6b754f4814f9', 'Enter', '
', 'General', 'serial', 't', 'f', NULL),
    ('36edfb91-78ac-4e69-8f03-34453f28b24f', 'Help', 'help
', 'General', 'serial', 't', 'f', NULL),
    ('87325559-6bf3-4fa7-8e1c-b17e1d730389', 'Show version', 'version
', 'General', 'serial', 't', 'f', NULL),
    ('9a3b801a-590d-479d-ab2b-9c6abfad1aa5', 'dmesg', 'dmesg
', 'Android serial', 'serial', 't', 'f', NULL),
    ('9302dd04-2121-4ac8-9789-c62c9ebdee54', 'List processes', 'ps
', 'Android serial', 'serial', 't', 'f', NULL),
    ('dff51c03-0a7e-4200-9fb7-760b8d4016cc', 'Storage information', 'df -h
', 'Android serial', 'serial', 't', 'f', NULL),
    ('84b9e850-9194-4f8f-934f-f15f65cbb2f0', 'Stop Android', 'stop
', 'Android serial', 'serial', 't', 't', NULL),
    ('8175a90b-9940-419c-a369-16d0c4e205f1', 'Start Android', 'start
', 'Android serial', 'serial', 't', 'f', NULL),
    ('46b3b629-2dbc-407c-bd87-907d0c41ca97', 'Reboot device', 'reboot
', 'Control', 'serial', 't', 't', NULL);


INSERT INTO system_configs (key, value, description, updated_by) VALUES
    ('app_name', 'Friendly AI Explorer', 'Application name', NULL);


INSERT INTO users (id, email, name, password_hash, role, avatar_url, is_active) VALUES
    ('44cfff7a-0f7d-42af-a5de-bac44c3a7d0c', 'dev@kaicheng.me', 'Developer', '$2b$12$L3J0iCKoxoRthQ6U754bkOpDvGVYHeXEkVkjnD4A9KLM34UVTjL2G', 'developer', NULL, 't');


COMMIT;
