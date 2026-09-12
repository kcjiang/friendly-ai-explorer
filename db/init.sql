-- ============================================================
--  Friendly AI Explorer — 数据库初始化脚本
--  由 Docker 首次启动时自动执行
-- ============================================================

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 枚举类型 ────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('developer', 'leader', 'engineer');

CREATE TYPE ticket_status AS ENUM (
  'open', 'in_progress', 'pending', 'resolved', 'closed'
);

CREATE TYPE ticket_priority AS ENUM (
  'critical', 'high', 'medium', 'low'
);

CREATE TYPE doc_visibility AS ENUM ('public', 'private');

CREATE TYPE ai_task_status AS ENUM (
  'pending', 'running', 'done', 'failed'
);

-- ── 用户表 ──────────────────────────────────────────────────

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email        VARCHAR(255) UNIQUE NOT NULL,
  name         VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role         user_role NOT NULL DEFAULT 'engineer',
  avatar_url   VARCHAR(500),
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 默认开发者账号：dev@kaicheng.me / 123456
-- bcrypt hash of "123456" with 12 rounds
INSERT INTO users (email, name, password_hash, role) VALUES (
  'dev@kaicheng.me',
  'Developer',
  '$2b$12$L3J0iCKoxoRthQ6U754bkOpDvGVYHeXEkVkjnD4A9KLM34UVTjL2G',
  'developer'
);

-- ── 工单表 ──────────────────────────────────────────────────

CREATE TABLE tickets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_no        VARCHAR(50) UNIQUE NOT NULL,
  title            VARCHAR(500) NOT NULL,
  description      TEXT,
  customer_name    VARCHAR(200),
  customer_contact VARCHAR(200),
  product_name     VARCHAR(200),
  firmware_version VARCHAR(100),
  status           ticket_status NOT NULL DEFAULT 'open',
  priority         ticket_priority NOT NULL DEFAULT 'medium',
  assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  creator_id       UUID NOT NULL REFERENCES users(id),
  ai_analysis      TEXT,
  ai_suggestions   TEXT,
  tags             TEXT[],
  attachments      JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

-- 工单自增序号（用于生成 ticket_no，如 KC-2024-001）
CREATE SEQUENCE ticket_seq START 1;

-- 工单评论表
CREATE TABLE ticket_comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 知识库文档表 ─────────────────────────────────────────────

CREATE TABLE documents (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title              VARCHAR(500) NOT NULL,
  content            TEXT,
  content_type       VARCHAR(50) DEFAULT 'markdown',
  file_url           VARCHAR(500),
  file_original_name VARCHAR(255),
  visibility         doc_visibility DEFAULT 'public',
  author_id          UUID NOT NULL REFERENCES users(id),
  is_published       BOOLEAN DEFAULT false,
  tags               TEXT[],
  view_count         INT DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 文档向量块表（RAG 核心）
CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(768),       -- Gemini text-embedding-004 输出维度
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 向量检索索引（cosine 相似度）
CREATE INDEX ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── AI 任务表 ────────────────────────────────────────────────

CREATE TABLE ai_tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_type     VARCHAR(100) NOT NULL,
  status        ai_task_status DEFAULT 'pending',
  input_data    JSONB,
  output_data   JSONB,
  user_id       UUID REFERENCES users(id),
  ticket_id     UUID REFERENCES tickets(id),
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- ── 审计日志表 ───────────────────────────────────────────────

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id),
  action        VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id   UUID,
  details       JSONB,
  ip_address    INET,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 系统配置表 ───────────────────────────────────────────────

CREATE TABLE system_configs (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_configs (key, value, description) VALUES
  ('app_name',    'Friendly AI Explorer', '应用名称'),
  ('app_version', '1.0.0',               '应用版本'),
  ('ai_model',    'gemini-2.5-flash',     '当前使用的 AI 模型');

-- ── 更新时间触发器 ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
