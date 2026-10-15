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
  legacy_ticket_no?: string;
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
  { label: string; bgColor: string; dotColor: string; textColor: string }
> = {
  open: {
    label: "新工单",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    dotColor: "bg-blue-500",
    textColor: "text-blue-600 dark:text-blue-400",
  },
  reproducing: {
    label: "待复现",
    bgColor: "bg-violet-50 dark:bg-violet-950/30",
    dotColor: "bg-violet-500",
    textColor: "text-violet-600 dark:text-violet-400",
  },
  in_progress: {
    label: "修复中",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    dotColor: "bg-amber-500",
    textColor: "text-amber-600 dark:text-amber-400",
  },
  verifying: {
    label: "验证修复",
    bgColor: "bg-cyan-50 dark:bg-cyan-950/30",
    dotColor: "bg-cyan-500",
    textColor: "text-cyan-600 dark:text-cyan-400",
  },
  pending: {
    label: "挂起",
    bgColor: "bg-slate-100 dark:bg-slate-800/40",
    dotColor: "bg-slate-500",
    textColor: "text-slate-600 dark:text-slate-400",
  },
  resolved: {
    label: "已解决",
    bgColor: "bg-green-50 dark:bg-green-950/30",
    dotColor: "bg-green-500",
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
  "微信",
  "MSTeams",
  "Slack",
  "TAPD",
  "其他",
];
