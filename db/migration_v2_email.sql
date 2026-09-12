-- 手动执行方式：
-- docker exec -i fae_postgres psql -U admin -d fae_app_pgdb < db/migration_v2_email.sql

CREATE TABLE IF NOT EXISTS email_accounts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_address      VARCHAR(255) NOT NULL,
  imap_host          VARCHAR(255) NOT NULL,
  imap_port          INT DEFAULT 993,
  username           VARCHAR(255) NOT NULL,
  password_encrypted TEXT NOT NULL,
  use_ssl            BOOLEAN DEFAULT true,
  is_active          BOOLEAN DEFAULT true,
  last_synced_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)   -- 每人一个账号
);

CREATE TABLE IF NOT EXISTS synced_emails (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id           UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id           VARCHAR(500) NOT NULL,
  subject              VARCHAR(500),
  sender               VARCHAR(500),
  body_text            TEXT,
  received_at          TIMESTAMPTZ,
  is_analyzed          BOOLEAN DEFAULT false,
  ai_is_customer_email BOOLEAN,
  ai_is_defect_report  BOOLEAN,
  ai_summary           TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, message_id)
);

CREATE TABLE IF NOT EXISTS pre_tickets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_id          UUID NOT NULL REFERENCES synced_emails(id) ON DELETE CASCADE,
  creator_id        UUID NOT NULL REFERENCES users(id),
  title             VARCHAR(500) NOT NULL,
  description       TEXT,
  customer_name     VARCHAR(200),
  customer_contact  VARCHAR(200),
  product_name      VARCHAR(200),
  firmware_version  VARCHAR(100),
  priority          VARCHAR(50) DEFAULT 'medium',
  status            VARCHAR(50) DEFAULT 'pending_review',
  created_ticket_id UUID REFERENCES tickets(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
