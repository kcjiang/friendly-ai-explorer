-- Friendly AI Explorer: clean database baseline (2026-10-20).
-- Fresh databases only. Contains schema and default seeds, never historical business data.
-- Historical migrations are archived and must not run after this baseline.
--
-- PostgreSQL database dump
--

\restrict 6eXizrOSFyeHSXg2tVMzdWZxjHhEF01opq0IdT3Kr10ztRqhAxZD7WNiiQePSVy

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: ai_task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_task_status AS ENUM (
    'pending',
    'running',
    'done',
    'failed'
);


--
-- Name: doc_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.doc_visibility AS ENUM (
    'public',
    'private'
);


--
-- Name: ticket_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ticket_priority AS ENUM (
    'critical',
    'high',
    'medium',
    'low'
);


--
-- Name: ticket_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ticket_status AS ENUM (
    'open',
    'in_progress',
    'pending',
    'resolved',
    'closed'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'developer',
    'leader',
    'engineer'
);


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_call_logs (
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
    diagnostics jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    protocol character varying(30) NOT NULL,
    base_url character varying(1000) NOT NULL,
    model character varying(200) NOT NULL,
    api_key_encrypted text,
    use_env_key boolean DEFAULT false NOT NULL,
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
    CONSTRAINT ai_providers_max_concurrency_check CHECK (((max_concurrency >= 1) AND (max_concurrency <= 32))),
    CONSTRAINT ai_providers_max_output_tokens_check CHECK (((max_output_tokens >= 16) AND (max_output_tokens <= 65536))),
    CONSTRAINT ai_providers_protocol_check CHECK (((protocol)::text = ANY ((ARRAY['gemini'::character varying, 'openai'::character varying])::text[]))),
    CONSTRAINT ai_providers_retry_count_check CHECK (((retry_count >= 0) AND (retry_count <= 2))),
    CONSTRAINT ai_providers_structured_output_check CHECK (((structured_output)::text = ANY ((ARRAY['auto'::character varying, 'schema'::character varying, 'object'::character varying, 'off'::character varying])::text[]))),
    CONSTRAINT ai_providers_temperature_check CHECK (((temperature >= (0)::double precision) AND (temperature <= (2)::double precision))),
    CONSTRAINT ai_providers_thinking_mode_check CHECK (((thinking_mode)::text = ANY ((ARRAY['auto'::character varying, 'off'::character varying, 'on'::character varying])::text[]))),
    CONSTRAINT ai_providers_timeout_seconds_check CHECK (((timeout_seconds >= 5) AND (timeout_seconds <= 300)))
);


--
-- Name: ai_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_routes (
    task character varying(40) NOT NULL,
    provider_id uuid,
    fallback_provider_id uuid,
    timeout_seconds integer,
    max_output_tokens integer,
    CONSTRAINT ai_routes_check CHECK ((((task)::text <> 'default'::text) OR (provider_id IS NOT NULL))),
    CONSTRAINT ai_routes_check1 CHECK (((provider_id IS NULL) OR (fallback_provider_id IS NULL) OR (provider_id <> fallback_provider_id))),
    CONSTRAINT ai_routes_max_output_tokens_check CHECK (((max_output_tokens >= 16) AND (max_output_tokens <= 65536))),
    CONSTRAINT ai_routes_task_check CHECK (((task)::text = ANY ((ARRAY['default'::character varying, 'todo'::character varying, 'ticket_analysis'::character varying, 'email_analysis'::character varying, 'rag_chat'::character varying])::text[]))),
    CONSTRAINT ai_routes_timeout_seconds_check CHECK (((timeout_seconds >= 5) AND (timeout_seconds <= 300)))
);


--
-- Name: ai_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    task_type character varying(100) NOT NULL,
    status public.ai_task_status DEFAULT 'pending'::public.ai_task_status,
    input_data jsonb,
    output_data jsonb,
    user_id uuid,
    ticket_id uuid,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    resource_type character varying(100),
    resource_id uuid,
    details jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: catalog_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_customers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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
    identification_name character varying(340) NOT NULL
);


--
-- Name: catalog_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_options (
    category character varying(30) NOT NULL,
    value character varying(100) NOT NULL
);


--
-- Name: catalog_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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
    identification_name character varying(340) NOT NULL
);


--
-- Name: catalog_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_projects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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
    fae_id uuid
);


--
-- Name: catalog_schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_schema_migrations (
    version integer NOT NULL
);


--
-- Name: document_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_chunks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(768),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(500) NOT NULL,
    content text,
    content_type character varying(50) DEFAULT 'markdown'::character varying,
    file_url character varying(500),
    file_original_name character varying(255),
    visibility public.doc_visibility DEFAULT 'public'::public.doc_visibility,
    author_id uuid NOT NULL,
    is_published boolean DEFAULT false,
    tags text[],
    view_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    email_address character varying(255) NOT NULL,
    imap_host character varying(255) NOT NULL,
    imap_port integer DEFAULT 993,
    username character varying(255) NOT NULL,
    password_encrypted text NOT NULL,
    use_ssl boolean DEFAULT true,
    is_active boolean DEFAULT true,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: embedding_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_settings (
    id integer NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT embedding_settings_id_check CHECK ((id = 1))
);


--
-- Name: pre_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_tickets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    title character varying(500) NOT NULL,
    description text,
    customer_name character varying(200),
    customer_contact character varying(200),
    product_name character varying(200),
    firmware_version character varying(100),
    priority character varying(50) DEFAULT 'medium'::character varying,
    status character varying(50) DEFAULT 'pending_review'::character varying,
    created_ticket_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: preset_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_commands (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(200) NOT NULL,
    command text NOT NULL,
    group_name character varying(100) DEFAULT '通用'::character varying,
    device_type character varying(20) NOT NULL,
    is_public boolean DEFAULT false,
    is_danger boolean DEFAULT false,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT preset_commands_device_type_check CHECK (((device_type)::text = ANY ((ARRAY['adb'::character varying, 'serial'::character varying])::text[])))
);


--
-- Name: scheduled_ai_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_ai_tasks (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    account_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    jql text NOT NULL,
    interval_minutes integer DEFAULT 60 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    last_run_at timestamp with time zone,
    last_error text,
    CONSTRAINT scheduled_ai_tasks_interval_minutes_check CHECK ((interval_minutes >= 5))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: synced_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synced_emails (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    account_id uuid NOT NULL,
    message_id character varying(500) NOT NULL,
    subject character varying(500),
    sender character varying(500),
    body_text text,
    received_at timestamp with time zone,
    is_analyzed boolean DEFAULT false,
    ai_is_customer_email boolean,
    ai_is_defect_report boolean,
    ai_summary text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_configs (
    key character varying(100) NOT NULL,
    value text,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_accounts (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    base_url character varying(500) NOT NULL,
    username character varying(255) NOT NULL,
    password_encrypted text NOT NULL
);


--
-- Name: task_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_issues (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    site character varying(500) NOT NULL,
    issue_key character varying(100) NOT NULL,
    source jsonb NOT NULL,
    draft jsonb,
    processed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_preferences (
    user_id uuid NOT NULL,
    prompt_id uuid,
    language character varying(10) DEFAULT 'zh-CN'::character varying NOT NULL,
    CONSTRAINT task_preferences_language_check CHECK (((language)::text = ANY ((ARRAY['zh-CN'::character varying, 'en'::character varying])::text[])))
);


--
-- Name: task_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_prompts (
    id uuid NOT NULL,
    owner_id uuid,
    name character varying(150) NOT NULL,
    content text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_runs (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    success boolean NOT NULL,
    found integer DEFAULT 0 NOT NULL,
    added integer DEFAULT 0 NOT NULL,
    message text NOT NULL
);


--
-- Name: task_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_templates (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    fields jsonb NOT NULL
);


--
-- Name: ticket_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    is_internal boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ticket_project_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_project_counters (
    project_id uuid NOT NULL,
    last_value bigint NOT NULL,
    CONSTRAINT ticket_project_counters_last_value_check CHECK ((last_value > 0))
);


--
-- Name: ticket_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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
    attachments jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    legacy_ticket_no character varying(50),
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
    CONSTRAINT tickets_priority_check CHECK (((priority)::text = ANY ((ARRAY['trivial'::character varying, 'critical'::character varying, 'major'::character varying])::text[]))),
    CONSTRAINT tickets_project_sequence_check CHECK ((((project_id IS NULL) AND (project_seq IS NULL)) OR ((project_id IS NOT NULL) AND (project_seq > 0)))),
    CONSTRAINT tickets_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'reproducing'::character varying, 'in_progress'::character varying, 'verifying'::character varying, 'pending'::character varying, 'resolved'::character varying])::text[])))
);


--
-- Name: uploaded_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    device_type character varying(20) NOT NULL,
    filename character varying(500) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_size bigint DEFAULT 0,
    line_count integer DEFAULT 0,
    description character varying(500),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT uploaded_logs_device_type_check CHECK (((device_type)::text = ANY ((ARRAY['adb'::character varying, 'serial'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role public.user_role DEFAULT 'engineer'::public.user_role NOT NULL,
    avatar_url character varying(500),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Data for Name: ai_call_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_call_logs (id, task, provider_id, provider_name, model, success, fallback, elapsed_ms, input_tokens, output_tokens, error, created_at, request_id, diagnostics) FROM stdin;
\.


--
-- Data for Name: ai_providers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_providers (id, name, protocol, base_url, model, api_key_encrypted, use_env_key, enabled, timeout_seconds, max_output_tokens, max_concurrency, last_test_at, last_test_ok, last_test_message, updated_at, thinking_mode, structured_output, temperature, retry_count) FROM stdin;
00000000-0000-0000-0000-000000000001	原有 Gemini（环境变量密钥）	gemini	https://generativelanguage.googleapis.com/v1beta	gemini-2.5-flash	\N	t	t	90	2048	4	\N	\N	\N	2026-10-20 09:51:24.912555+00	auto	auto	\N	1
\.


--
-- Data for Name: ai_routes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_routes (task, provider_id, fallback_provider_id, timeout_seconds, max_output_tokens) FROM stdin;
default	00000000-0000-0000-0000-000000000001	\N	\N	\N
todo	\N	\N	\N	\N
ticket_analysis	\N	\N	\N	\N
email_analysis	\N	\N	\N	\N
rag_chat	\N	\N	\N	\N
\.


--
-- Data for Name: ai_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_tasks (id, task_type, status, input_data, output_data, user_id, ticket_id, error_message, created_at, completed_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: catalog_customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.catalog_customers (id, company_name, country_code, country_name, level, contacts, notes, created_by, updated_by, created_at, updated_at, revision, deleted_at, deleted_by, business, identification_name) FROM stdin;
\.


--
-- Data for Name: catalog_options; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.catalog_options (category, value) FROM stdin;
customer_level	KA
customer_level	LA
customer_level	SMB
product_type	OTT
product_type	IPC
product_type	NetCom
project_stage	EV
project_stage	EVT
project_stage	DVT
project_stage	PVT
project_stage	MR
project_stage	MP
\.


--
-- Data for Name: catalog_products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.catalog_products (id, type, model, chipset, system, repository_url, notes, created_by, updated_by, created_at, updated_at, revision, deleted_at, deleted_by, fingerprint, identification_name) FROM stdin;
\.


--
-- Data for Name: catalog_projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.catalog_projects (id, number, pm, stage, customer_id, product_id, created_by, updated_by, created_at, updated_at, revision, deleted_at, deleted_by, start_date, fae_id) FROM stdin;
\.


--
-- Data for Name: catalog_schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.catalog_schema_migrations (version) FROM stdin;
17
\.


--
-- Data for Name: document_chunks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.document_chunks (id, document_id, chunk_index, content, embedding, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.documents (id, title, content, content_type, file_url, file_original_name, visibility, author_id, is_published, tags, view_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: email_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_accounts (id, user_id, email_address, imap_host, imap_port, username, password_encrypted, use_ssl, is_active, last_synced_at, created_at) FROM stdin;
\.


--
-- Data for Name: embedding_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.embedding_settings (id, config) FROM stdin;
1	{}
\.


--
-- Data for Name: pre_tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pre_tickets (id, email_id, creator_id, title, description, customer_name, customer_contact, product_name, firmware_version, priority, status, created_ticket_id, created_at) FROM stdin;
\.


--
-- Data for Name: preset_commands; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.preset_commands (id, name, command, group_name, device_type, is_public, is_danger, owner_id, created_at, updated_at) FROM stdin;
a49f2f54-ff7c-44de-a65e-f3b1f9edd9e5	型号	getprop ro.product.model	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
3e42f166-838c-4887-8eb6-6fb589a7a1fd	系统版本	getprop ro.build.version.release	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
3f3e8cbb-d72d-40de-b3f7-a58695fa49c8	所有属性	getprop	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
6dd54701-e2e5-4beb-ab9e-fc05d02ce017	屏幕分辨率	wm size	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
45d1852f-3627-415d-8f44-637dd9f5cb55	磁盘空间	df -h	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
684249e3-d113-471d-b412-06cedfbe2682	内存信息	free -h	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
bfba44e9-9a06-49ef-ac6c-e20e55270b90	电池状态	dumpsys battery	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
5fe88648-bbd5-4b6d-a59d-345c76d6e17a	网络接口	ip addr show	设备信息	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
fa5e2f70-2da5-4aff-b190-e6ed4e3efa83	三方应用	pm list packages -3	应用管理	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
74bf2f9d-cbc2-458f-a02a-e1689c2b26d0	前台应用	dumpsys activity | grep -i resumed	应用管理	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
4430ec40-6748-4ace-b885-648dd6584f8a	清除日志	logcat -c && echo "日志已清除"	应用管理	adb	t	f	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
aae71d39-b36a-4f02-bbce-45f2c033ea23	重启	reboot	控制	adb	t	t	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
49e72196-9810-4210-a410-41ae3b07d17c	重启 Recovery	reboot recovery	控制	adb	t	t	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
c225708a-79aa-46d2-bae2-e3c56f569b07	重启 Bootloader	reboot bootloader	控制	adb	t	t	\N	2026-10-20 09:51:24.813933+00	2026-10-20 09:51:24.813933+00
0aa814fe-5e78-4086-ac05-6b754f4814f9	回车	\r\n	通用	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
36edfb91-78ac-4e69-8f03-34453f28b24f	帮助	help\r\n	通用	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
87325559-6bf3-4fa7-8e1c-b17e1d730389	查看版本	version\r\n	通用	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
9a3b801a-590d-479d-ab2b-9c6abfad1aa5	dmesg	dmesg\r\n	Android 串口	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
9302dd04-2121-4ac8-9789-c62c9ebdee54	查看进程	ps\r\n	Android 串口	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
dff51c03-0a7e-4200-9fb7-760b8d4016cc	存储信息	df -h\r\n	Android 串口	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
84b9e850-9194-4f8f-934f-f15f65cbb2f0	停止 Android	stop\r\n	Android 串口	serial	t	t	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
8175a90b-9940-419c-a369-16d0c4e205f1	启动 Android	start\r\n	Android 串口	serial	t	f	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
46b3b629-2dbc-407c-bd87-907d0c41ca97	重启设备	reboot\r\n	控制	serial	t	t	\N	2026-10-20 09:51:24.815394+00	2026-10-20 09:51:24.815394+00
\.


--
-- Data for Name: scheduled_ai_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheduled_ai_tasks (id, user_id, account_id, name, jql, interval_minutes, enabled, next_run_at, last_run_at, last_error) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (name, applied_at) FROM stdin;
v6_tickets	2026-10-20 09:51:24.862452+00
\.


--
-- Data for Name: synced_emails; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.synced_emails (id, account_id, message_id, subject, sender, body_text, received_at, is_analyzed, ai_is_customer_email, ai_is_defect_report, ai_summary, created_at) FROM stdin;
\.


--
-- Data for Name: system_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_configs (key, value, description, updated_by, updated_at) FROM stdin;
app_name	Friendly AI Explorer	应用名称	\N	2026-10-20 09:51:24.767105+00
ai_model	gemini-2.5-flash	当前使用的 AI 模型	\N	2026-10-20 09:51:24.767105+00
\.


--
-- Data for Name: task_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_accounts (id, user_id, name, base_url, username, password_encrypted) FROM stdin;
\.


--
-- Data for Name: task_issues; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_issues (id, user_id, site, issue_key, source, draft, processed, updated_at) FROM stdin;
\.


--
-- Data for Name: task_preferences; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_preferences (user_id, prompt_id, language) FROM stdin;
\.


--
-- Data for Name: task_prompts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_prompts (id, owner_id, name, content, revision, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000001	\N	Jira → TAPD 准确整理	你是一名熟悉研发缺陷管理的 FAE。请将客户在 Jira 提报的问题整理成内部研发能够直接理解和复现的 TAPD 缺陷草稿。\r\n按照本次指定的输出语言重新组织表达，而非机械复制原文。保留产品型号、版本号、命令、错误码等技术细节，不改变原意。\r\n区分客户描述与后续评论；如果评论存在争议或信息不一致，应准确标出待确认事项，不将猜测写成结论。\r\n根据模板逐项填写问题现象、已明确的前置条件、复现步骤、预期结果和实际结果。原文没有的信息留空，不编造复现步骤、版本、概率或根因。\r\n出现概率只使用客户明确报告的复现频率，不得误用 Jira 优先级或严重程度。分析仅包含有依据的原因分析。\r\n附件仅列出实际存在的文件；客户原始描述由系统原样保留，便于核对。	1	2026-10-20 09:51:24.99236+00	2026-10-20 09:51:24.99236+00
\.


--
-- Data for Name: task_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_runs (id, task_id, user_id, started_at, success, found, added, message) FROM stdin;
\.


--
-- Data for Name: task_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_templates (id, user_id, name, fields) FROM stdin;
\.


--
-- Data for Name: ticket_comments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_comments (id, ticket_id, author_id, content, is_internal, created_at) FROM stdin;
\.


--
-- Data for Name: ticket_project_counters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_project_counters (project_id, last_value) FROM stdin;
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tickets (id, ticket_no, title, description, customer_name, customer_contact, product_name, firmware_version, status, priority, assignee_id, creator_id, ai_analysis, ai_suggestions, tags, attachments, created_at, updated_at, resolved_at, legacy_ticket_no, system_seq, project_id, project_seq, source, source_number, source_url, raw_report, tapd_created, tapd_url, status_note, next_plan, notes, updated_by, revision) FROM stdin;
\.


--
-- Data for Name: uploaded_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.uploaded_logs (id, user_id, device_type, filename, file_path, file_size, line_count, description, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, name, password_hash, role, avatar_url, is_active, created_at, updated_at) FROM stdin;
44cfff7a-0f7d-42af-a5de-bac44c3a7d0c	dev@kaicheng.me	Developer	$2b$12$L3J0iCKoxoRthQ6U754bkOpDvGVYHeXEkVkjnD4A9KLM34UVTjL2G	developer	\N	t	2026-10-20 09:51:24.666624+00	2026-10-20 09:51:24.666624+00
\.


--
-- Name: ticket_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_seq', 1, false);


--
-- Name: ai_call_logs ai_call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_logs
    ADD CONSTRAINT ai_call_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: ai_routes ai_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_routes
    ADD CONSTRAINT ai_routes_pkey PRIMARY KEY (task);


--
-- Name: ai_tasks ai_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tasks
    ADD CONSTRAINT ai_tasks_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: catalog_customers catalog_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_customers
    ADD CONSTRAINT catalog_customers_pkey PRIMARY KEY (id);


--
-- Name: catalog_options catalog_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_options
    ADD CONSTRAINT catalog_options_pkey PRIMARY KEY (category, value);


--
-- Name: catalog_products catalog_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_products
    ADD CONSTRAINT catalog_products_pkey PRIMARY KEY (id);


--
-- Name: catalog_projects catalog_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_pkey PRIMARY KEY (id);


--
-- Name: catalog_schema_migrations catalog_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_schema_migrations
    ADD CONSTRAINT catalog_schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: document_chunks document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: email_accounts email_accounts_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_user_id_key UNIQUE (user_id);


--
-- Name: embedding_settings embedding_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_settings
    ADD CONSTRAINT embedding_settings_pkey PRIMARY KEY (id);


--
-- Name: pre_tickets pre_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tickets
    ADD CONSTRAINT pre_tickets_pkey PRIMARY KEY (id);


--
-- Name: preset_commands preset_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_commands
    ADD CONSTRAINT preset_commands_pkey PRIMARY KEY (id);


--
-- Name: scheduled_ai_tasks scheduled_ai_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_ai_tasks
    ADD CONSTRAINT scheduled_ai_tasks_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: synced_emails synced_emails_account_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_emails
    ADD CONSTRAINT synced_emails_account_id_message_id_key UNIQUE (account_id, message_id);


--
-- Name: synced_emails synced_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_emails
    ADD CONSTRAINT synced_emails_pkey PRIMARY KEY (id);


--
-- Name: system_configs system_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_configs
    ADD CONSTRAINT system_configs_pkey PRIMARY KEY (key);


--
-- Name: task_accounts task_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_accounts
    ADD CONSTRAINT task_accounts_pkey PRIMARY KEY (id);


--
-- Name: task_issues task_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_issues
    ADD CONSTRAINT task_issues_pkey PRIMARY KEY (id);


--
-- Name: task_issues task_issues_user_id_site_issue_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_issues
    ADD CONSTRAINT task_issues_user_id_site_issue_key_key UNIQUE (user_id, site, issue_key);


--
-- Name: task_preferences task_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preferences
    ADD CONSTRAINT task_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: task_prompts task_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_prompts
    ADD CONSTRAINT task_prompts_pkey PRIMARY KEY (id);


--
-- Name: task_runs task_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_pkey PRIMARY KEY (id);


--
-- Name: task_templates task_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_pkey PRIMARY KEY (id);


--
-- Name: ticket_comments ticket_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_pkey PRIMARY KEY (id);


--
-- Name: ticket_project_counters ticket_project_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_project_counters
    ADD CONSTRAINT ticket_project_counters_pkey PRIMARY KEY (project_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_project_sequence_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_project_sequence_unique UNIQUE (project_id, project_seq);


--
-- Name: tickets tickets_system_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_system_seq_key UNIQUE (system_seq);


--
-- Name: tickets tickets_ticket_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_ticket_no_key UNIQUE (ticket_no);


--
-- Name: uploaded_logs uploaded_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_logs
    ADD CONSTRAINT uploaded_logs_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ai_call_logs_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_call_logs_created_idx ON public.ai_call_logs USING btree (created_at DESC);


--
-- Name: ai_call_logs_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_call_logs_request_idx ON public.ai_call_logs USING btree (request_id);


--
-- Name: catalog_customers_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_customers_deleted_idx ON public.catalog_customers USING btree (deleted_at);


--
-- Name: catalog_customers_identification_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX catalog_customers_identification_idx ON public.catalog_customers USING btree (identification_name);


--
-- Name: catalog_customers_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_customers_updated_idx ON public.catalog_customers USING btree (updated_at);


--
-- Name: catalog_products_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_products_deleted_idx ON public.catalog_products USING btree (deleted_at);


--
-- Name: catalog_products_identification_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX catalog_products_identification_idx ON public.catalog_products USING btree (identification_name);


--
-- Name: catalog_products_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_products_updated_idx ON public.catalog_products USING btree (updated_at);


--
-- Name: catalog_projects_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_projects_customer_idx ON public.catalog_projects USING btree (customer_id);


--
-- Name: catalog_projects_deleted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_projects_deleted_idx ON public.catalog_projects USING btree (deleted_at);


--
-- Name: catalog_projects_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_projects_product_idx ON public.catalog_projects USING btree (product_id);


--
-- Name: catalog_projects_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_projects_updated_idx ON public.catalog_projects USING btree (updated_at);


--
-- Name: document_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_chunks_embedding_idx ON public.document_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: idx_catalog_projects_fae; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalog_projects_fae ON public.catalog_projects USING btree (fae_id);


--
-- Name: ix_scheduled_ai_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scheduled_ai_tasks_due ON public.scheduled_ai_tasks USING btree (next_run_at) WHERE enabled;


--
-- Name: ix_scheduled_ai_tasks_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scheduled_ai_tasks_user ON public.scheduled_ai_tasks USING btree (user_id);


--
-- Name: ix_task_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_accounts_user ON public.task_accounts USING btree (user_id);


--
-- Name: ix_task_issues_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_issues_user ON public.task_issues USING btree (user_id);


--
-- Name: ix_task_runs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_runs_user ON public.task_runs USING btree (user_id, started_at DESC);


--
-- Name: ix_task_templates_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_templates_user ON public.task_templates USING btree (user_id);


--
-- Name: tickets_assignee_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_assignee_status_idx ON public.tickets USING btree (assignee_id, status);


--
-- Name: tickets_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_updated_idx ON public.tickets USING btree (updated_at DESC);


--
-- Name: documents trg_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tickets trg_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tickets_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: ai_call_logs ai_call_logs_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_logs
    ADD CONSTRAINT ai_call_logs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.ai_providers(id) ON DELETE SET NULL;


--
-- Name: ai_routes ai_routes_fallback_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_routes
    ADD CONSTRAINT ai_routes_fallback_provider_id_fkey FOREIGN KEY (fallback_provider_id) REFERENCES public.ai_providers(id);


--
-- Name: ai_routes ai_routes_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_routes
    ADD CONSTRAINT ai_routes_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.ai_providers(id);


--
-- Name: ai_tasks ai_tasks_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tasks
    ADD CONSTRAINT ai_tasks_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: ai_tasks ai_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tasks
    ADD CONSTRAINT ai_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: catalog_customers catalog_customers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_customers
    ADD CONSTRAINT catalog_customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: catalog_customers catalog_customers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_customers
    ADD CONSTRAINT catalog_customers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: catalog_customers catalog_customers_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_customers
    ADD CONSTRAINT catalog_customers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: catalog_products catalog_products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_products
    ADD CONSTRAINT catalog_products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: catalog_products catalog_products_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_products
    ADD CONSTRAINT catalog_products_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: catalog_products catalog_products_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_products
    ADD CONSTRAINT catalog_products_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: catalog_projects catalog_projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: catalog_projects catalog_projects_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.catalog_customers(id);


--
-- Name: catalog_projects catalog_projects_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: catalog_projects catalog_projects_fae_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_fae_id_fkey FOREIGN KEY (fae_id) REFERENCES public.users(id);


--
-- Name: catalog_projects catalog_projects_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.catalog_products(id);


--
-- Name: catalog_projects catalog_projects_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_projects
    ADD CONSTRAINT catalog_projects_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: document_chunks document_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents documents_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: email_accounts email_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pre_tickets pre_tickets_created_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tickets
    ADD CONSTRAINT pre_tickets_created_ticket_id_fkey FOREIGN KEY (created_ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: pre_tickets pre_tickets_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tickets
    ADD CONSTRAINT pre_tickets_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: pre_tickets pre_tickets_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_tickets
    ADD CONSTRAINT pre_tickets_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.synced_emails(id) ON DELETE CASCADE;


--
-- Name: preset_commands preset_commands_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_commands
    ADD CONSTRAINT preset_commands_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scheduled_ai_tasks scheduled_ai_tasks_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_ai_tasks
    ADD CONSTRAINT scheduled_ai_tasks_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.task_accounts(id) ON DELETE RESTRICT;


--
-- Name: scheduled_ai_tasks scheduled_ai_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_ai_tasks
    ADD CONSTRAINT scheduled_ai_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: synced_emails synced_emails_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_emails
    ADD CONSTRAINT synced_emails_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: system_configs system_configs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_configs
    ADD CONSTRAINT system_configs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: task_accounts task_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_accounts
    ADD CONSTRAINT task_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_issues task_issues_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_issues
    ADD CONSTRAINT task_issues_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_preferences task_preferences_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preferences
    ADD CONSTRAINT task_preferences_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.task_prompts(id) ON DELETE SET NULL;


--
-- Name: task_preferences task_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preferences
    ADD CONSTRAINT task_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_prompts task_prompts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_prompts
    ADD CONSTRAINT task_prompts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_runs task_runs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.scheduled_ai_tasks(id) ON DELETE CASCADE;


--
-- Name: task_runs task_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_templates task_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_templates
    ADD CONSTRAINT task_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ticket_comments ticket_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: ticket_comments ticket_comments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_project_counters ticket_project_counters_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_project_counters
    ADD CONSTRAINT ticket_project_counters_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.catalog_projects(id);


--
-- Name: tickets tickets_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: tickets tickets_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.catalog_projects(id);


--
-- Name: tickets tickets_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: uploaded_logs uploaded_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_logs
    ADD CONSTRAINT uploaded_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 6eXizrOSFyeHSXg2tVMzdWZxjHhEF01opq0IdT3Kr10ztRqhAxZD7WNiiQePSVy
