BEGIN;
CREATE TABLE IF NOT EXISTS task_accounts (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(150) NOT NULL, base_url VARCHAR(500) NOT NULL, username VARCHAR(255) NOT NULL,
 password_encrypted TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_task_accounts_user ON task_accounts(user_id);
CREATE TABLE IF NOT EXISTS task_templates (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(150) NOT NULL, fields JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_task_templates_user ON task_templates(user_id);
CREATE TABLE IF NOT EXISTS scheduled_ai_tasks (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id UUID NOT NULL REFERENCES task_accounts(id) ON DELETE RESTRICT,
 name VARCHAR(150) NOT NULL, jql TEXT NOT NULL, interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK(interval_minutes >= 5),
 enabled BOOLEAN NOT NULL DEFAULT FALSE, next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_run_at TIMESTAMPTZ, last_error TEXT
);
CREATE INDEX IF NOT EXISTS ix_scheduled_ai_tasks_user ON scheduled_ai_tasks(user_id);
CREATE INDEX IF NOT EXISTS ix_scheduled_ai_tasks_due ON scheduled_ai_tasks(next_run_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS task_issues (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 site VARCHAR(500) NOT NULL, issue_key VARCHAR(100) NOT NULL, source JSONB NOT NULL,
 draft JSONB, processed BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id, site, issue_key)
);
CREATE INDEX IF NOT EXISTS ix_task_issues_user ON task_issues(user_id);
CREATE TABLE IF NOT EXISTS task_runs (
 id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES scheduled_ai_tasks(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 success BOOLEAN NOT NULL, found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_task_runs_user ON task_runs(user_id, started_at DESC);
COMMIT;
