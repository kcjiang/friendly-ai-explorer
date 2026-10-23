export type Schedule = {
  enabled: boolean;
  interval_minutes: number;
  timezone: string;
  weekdays: number[];
  start: string;
  end: string;
};
export type Account = {
  id: string;
  name: string;
  platform: "jira" | "youtrack";
  base_url: string;
  username: string;
  project_id: string | null;
  mail_folder_id: string | null;
  enabled: boolean;
  status: string;
  error: string | null;
  last_run_at: string | null;
};
export type Step = {
  type: "read" | "ai" | "map" | "ticket" | "result";
  instruction?: string;
  project_id?: string | null;
  priority?: string;
};
export type Automation = {
  id: string;
  name: string;
  kind: string;
  steps: Step[];
};
export type Message = {
  id: string;
  account_id: string;
  payload: {
    key: string;
    title: string;
    body: string;
    url: string;
    attachments?: { name: string; url: string }[];
  };
  note: string;
  is_read: boolean;
  received_at: string;
  project_id: string | null;
  resource_updated_at: string | null;
  resource_source: {
    kind: string;
    mail_id?: string | null;
    timestamp?: string;
  } | null;
  submitted: boolean;
  dismissed: boolean;
  mails?: { id: string; subject: string; received_at: string }[];
  jobs?: Job[];
  jobs_total?: number;
  jobs_page?: number;
};
export type Job = {
  id: string;
  automation_id: string;
  status: "queued" | "running" | "completed" | "failed";
  snapshot: {
    payload: Message["payload"];
    note: string;
    summary?: string;
    account_name: string;
  };
  steps: Step[];
  step_index: number;
  error: string | null;
  ticket_id: string | null;
  logs: { at: string; step?: number; message: string }[];
  queued_at: string;
};
export type UpdateCheck = {
  id: number;
  status: "queued" | "running" | "completed" | "failed";
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};
export type Overview = {
  manual_check: UpdateCheck | null;
  has_mailboxes: boolean;
  schedule_configured: boolean;
  schedule: Schedule;
  next_run_at: string | null;
  last_run_at: string | null;
  accounts: Account[];
  automations: Automation[];
  messages: Message[];
  unread: Record<string, number>;
  counts: Record<string, Partial<Record<Job["status"], number>>>;
  total_messages: number;
  page: number;
  page_size: number;
};
