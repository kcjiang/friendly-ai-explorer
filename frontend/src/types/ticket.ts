export enum TicketStatus {
  open        = "open",
  in_progress = "in_progress",
  pending     = "pending",
  resolved    = "resolved",
  closed      = "closed",
}

export enum TicketPriority {
  critical = "critical",
  high     = "high",
  medium   = "medium",
  low      = "low",
}

export interface UserBrief {
  id:    string;
  name:  string;
  email: string;
  role:  string;
}

export interface TicketComment {
  id:          string;
  ticket_id:   string;
  content:     string;
  is_internal: boolean;
  author:      UserBrief;
  created_at:  string;
}

export interface Ticket {
  id:               string;
  ticket_no:        string;
  title:            string;
  description?:     string;
  customer_name?:   string;
  customer_contact?:string;
  product_name?:    string;
  firmware_version?:string;
  status:           TicketStatus;
  priority:         TicketPriority;
  assignee?:        UserBrief;
  creator:          UserBrief;
  ai_analysis?:     string;
  ai_suggestions?:  string;
  tags?:            string[];
  comments?:        TicketComment[];
  created_at:       string;
  updated_at:       string;
  resolved_at?:     string;
}

// ── 显示配置 ─────────────────────────────────────────────────

export const TICKET_STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; bgColor: string; dotColor: string; textColor: string }
> = {
  open:        { label: "待处理",  bgColor: "bg-blue-50 dark:bg-blue-950/30",   dotColor: "bg-blue-500",   textColor: "text-blue-600 dark:text-blue-400"   },
  in_progress: { label: "处理中",  bgColor: "bg-amber-50 dark:bg-amber-950/30", dotColor: "bg-amber-500",  textColor: "text-amber-600 dark:text-amber-400"  },
  pending:     { label: "等待客户", bgColor: "bg-yellow-50 dark:bg-yellow-950/30",dotColor: "bg-yellow-500",textColor: "text-yellow-600 dark:text-yellow-400"},
  resolved:    { label: "已解决",  bgColor: "bg-green-50 dark:bg-green-950/30", dotColor: "bg-green-500",  textColor: "text-green-600 dark:text-green-400"  },
  closed:      { label: "已关闭",  bgColor: "bg-slate-100 dark:bg-slate-800/40",dotColor: "bg-slate-400",  textColor: "text-slate-500 dark:text-slate-400"  },
};

export const TICKET_PRIORITY_CONFIG: Record<
  TicketPriority,
  { label: string; color: string }
> = {
  critical: { label: "严重", color: "bg-red-100    text-red-700    dark:bg-red-950/50    dark:text-red-400"    },
  high:     { label: "高",   color: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400" },
  medium:   { label: "中",   color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400" },
  low:      { label: "低",   color: "bg-green-100  text-green-700  dark:bg-green-950/50  dark:text-green-400"  },
};
