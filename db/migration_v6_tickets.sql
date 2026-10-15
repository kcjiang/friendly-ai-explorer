-- Run after migration_v5_catalog.sql. Existing records and original numbers are retained.
BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
LOCK TABLE tickets IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = 'v6_tickets') THEN
    ALTER TABLE tickets ALTER COLUMN status DROP DEFAULT, ALTER COLUMN priority DROP DEFAULT;
    ALTER TABLE tickets ALTER COLUMN status TYPE varchar(30) USING status::text,
        ALTER COLUMN priority TYPE varchar(20) USING priority::text;
    UPDATE tickets SET status = 'resolved' WHERE status = 'closed';
    UPDATE tickets SET priority = CASE WHEN priority = 'low' THEN 'trivial' WHEN priority IN ('high','medium') THEN 'major' ELSE priority END;
    ALTER TABLE tickets ALTER COLUMN status SET DEFAULT 'open', ALTER COLUMN priority SET DEFAULT 'major';
    ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('open','reproducing','in_progress','verifying','pending','resolved')),
        ADD CONSTRAINT tickets_priority_check CHECK (priority IN ('trivial','critical','major'));
    ALTER TABLE tickets ADD COLUMN legacy_ticket_no varchar(50),
        ADD COLUMN system_seq bigint UNIQUE,
        ADD COLUMN project_id uuid REFERENCES catalog_projects(id),
        ADD COLUMN project_seq bigint,
        ADD COLUMN source varchar(100) NOT NULL DEFAULT 'Email',
        ADD COLUMN source_number varchar(200) NOT NULL DEFAULT '',
        ADD COLUMN source_url varchar(2000) NOT NULL DEFAULT '',
        ADD COLUMN raw_report text NOT NULL DEFAULT '',
        ADD COLUMN tapd_created boolean NOT NULL DEFAULT false,
        ADD COLUMN tapd_url varchar(2000) NOT NULL DEFAULT '',
        ADD COLUMN status_note varchar(500) NOT NULL DEFAULT '',
        ADD COLUMN next_plan text NOT NULL DEFAULT '',
        ADD COLUMN notes text NOT NULL DEFAULT '',
        ADD COLUMN updated_by uuid REFERENCES users(id),
        ADD COLUMN revision integer NOT NULL DEFAULT 1;
    -- Reuse the existing global sequence, so numbers consumed by deleted old tickets stay consumed.
    WITH numbered AS MATERIALIZED (
        SELECT id, nextval('ticket_seq') AS seq FROM tickets ORDER BY created_at, id
    )
    UPDATE tickets t SET legacy_ticket_no = t.ticket_no, system_seq = n.seq, updated_by = t.creator_id
    FROM numbered n WHERE t.id = n.id;
    UPDATE tickets SET ticket_no = 'ft' || system_seq, assignee_id = COALESCE(assignee_id, creator_id);
    ALTER TABLE tickets ALTER COLUMN system_seq SET NOT NULL, ALTER COLUMN updated_by SET NOT NULL;
    ALTER TABLE tickets ADD CONSTRAINT tickets_project_sequence_unique UNIQUE (project_id, project_seq),
        ADD CONSTRAINT tickets_project_sequence_check CHECK ((project_id IS NULL AND project_seq IS NULL) OR (project_id IS NOT NULL AND project_seq > 0));
    CREATE TABLE ticket_project_counters (project_id uuid PRIMARY KEY REFERENCES catalog_projects(id), last_value bigint NOT NULL CHECK (last_value > 0));
    CREATE INDEX tickets_assignee_status_idx ON tickets (assignee_id, status);
    CREATE INDEX tickets_updated_idx ON tickets (updated_at DESC);
    -- Preserve email/AI history when a ticket is explicitly deleted.
    ALTER TABLE pre_tickets DROP CONSTRAINT pre_tickets_created_ticket_id_fkey;
    ALTER TABLE pre_tickets ADD CONSTRAINT pre_tickets_created_ticket_id_fkey FOREIGN KEY (created_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
    ALTER TABLE ai_tasks DROP CONSTRAINT ai_tasks_ticket_id_fkey;
    ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
    INSERT INTO schema_migrations(name) VALUES ('v6_tickets');
END IF;
END $$;
COMMIT;
