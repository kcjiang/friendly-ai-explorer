export type Mailbox = {
  id: string;
  address: string;
  username: string;
  imap_host: string;
  imap_port: number;
  imap_security: "ssl" | "starttls";
  smtp_host: string;
  smtp_port: number;
  smtp_security: "ssl" | "starttls";
  status: string;
  error: string | null;
  last_sync_at: string | null;
};
export type MailFolder = {
  id: string;
  mailbox_id: string;
  path: string;
  delimiter: string;
  selectable: boolean;
};
export type MailRule = {
  id: string;
  mailbox_id: string;
  folder_id: string;
  name: string;
  sender: string;
  keywords: string[];
  enabled: boolean;
};
export type MailItem = {
  id: string;
  mailbox_id: string;
  message_id: string;
  subject: string;
  sender: string;
  recipients: string;
  cc: string;
  received_at: string;
  is_read: boolean;
  rule_id: string | null;
  body_text: string;
  body_html: string;
  has_remote_images?: boolean;
  attachments: { index: number; name: string; size: number }[];
};
export type MailOverview = {
  unread_total: number;
  mailboxes: Mailbox[];
  folders: MailFolder[];
  rules: MailRule[];
  unread: Record<string, number>;
};
