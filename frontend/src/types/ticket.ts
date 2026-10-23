export enum TicketStatus {
  open = "open",
  reproducing = "reproducing",
  in_progress = "in_progress",
  verifying = "verifying",
  pending = "pending",
  resolved = "resolved",
}
export enum TicketPriority {
  trivial = "trivial",
  critical = "critical",
  major = "major",
}
export interface UserBrief {
  id: string;
  name: string;
  email: string;
  role: string;
}
export interface TicketComment {
  id: string;
  content: string;
  author: UserBrief;
  created_at: string;
  is_internal: boolean;
}
export interface Ticket {
  id: string;
  ticket_no: string;
  display_name: string;
  system_seq: number;
  project_id: string | null;
  project_seq: number | null;
  project_name: string;
  project_summary: string;
  title: string;
  description?: string;
  source: string;
  source_number: string;
  source_url: string;
  raw_report: string;
  tapd_created: boolean;
  tapd_url: string;
  status: TicketStatus;
  status_note: string;
  priority: TicketPriority;
  next_plan: string;
  notes: string;
  revision: number;
  can_edit: boolean;
  assignee?: UserBrief;
  creator: UserBrief;
  updater: UserBrief;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  product_name?: string;
  customer_contact?: string;
  firmware_version?: string;
  ai_analysis?: string;
  ai_suggestions?: string;
  tags?: string[];
  comments?: TicketComment[];
}
export const TICKET_STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; textColor: string }
> = {
  open: {
    label: "New",
    textColor: "text-blue-600 dark:text-blue-400",
  },
  reproducing: {
    label: "Reproducing",
    textColor: "text-violet-600 dark:text-violet-400",
  },
  in_progress: {
    label: "In progress",
    textColor: "text-amber-600 dark:text-amber-400",
  },
  verifying: {
    label: "Verifying",
    textColor: "text-cyan-600 dark:text-cyan-400",
  },
  pending: {
    label: "On hold",
    textColor: "text-slate-600 dark:text-slate-400",
  },
  resolved: {
    label: "Resolved",
    textColor: "text-green-600 dark:text-green-400",
  },
};
export const TICKET_PRIORITY_CONFIG: Record<
  TicketPriority,
  { label: string; color: string }
> = {
  trivial: {
    label: "Trivial",
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  critical: {
    label: "Critical",
    color: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  },
  major: {
    label: "Major",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
};
export const TICKET_SOURCES = [
  "WhatsApp",
  "Email",
  "WeChat",
  "MSTeams",
  "Slack",
  "TAPD",
  "Other",
];
