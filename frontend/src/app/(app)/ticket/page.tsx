"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api";
import {
  Ticket, TicketStatus, TicketPriority,
  TICKET_STATUS_CONFIG, TICKET_PRIORITY_CONFIG,
} from "@/types/ticket";
import TicketModal from "@/components/kanban/ticket-modal";

// ── Ticket Card ───────────────────────────────────────────────
function TicketCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const p = TICKET_PRIORITY_CONFIG[ticket.priority];
  const date = new Date(ticket.created_at).toLocaleDateString("zh-CN");

  return (
    <div
      onClick={onClick}
      className="bg-background border border-border rounded-xl p-4 cursor-pointer
                 hover:shadow-md hover:border-primary/40 transition-all duration-200 group"
    >
      {/* 工单号 + 优先级 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-mono">{ticket.ticket_no}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.color}`}>
          {p.label}
        </span>
      </div>

      {/* 标题 */}
      <p className="text-sm font-medium leading-snug mb-3 group-hover:text-primary transition-colors line-clamp-2">
        {ticket.title}
      </p>

      {/* 客户名 */}
      {ticket.customer_name && (
        <p className="text-xs text-muted-foreground mb-3 truncate">
          🏢 {ticket.customer_name}
        </p>
      )}

      {/* 标签 */}
      {ticket.tags && ticket.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {ticket.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 底部：日期 + 负责人 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{date}</span>
        {ticket.assignee ? (
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center
                          text-xs font-semibold text-primary" title={ticket.assignee.name}>
            {ticket.assignee.name[0].toUpperCase()}
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center
                          text-xs text-muted-foreground" title="未分配">
            ?
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function TicketPage() {
  const { data: session } = useSession();
  const [tickets,        setTickets]       = useState<Ticket[]>([]);
  const [loading,        setLoading]       = useState(true);
  const [selectedTicket, setSelected]      = useState<Ticket | null>(null);
  const [showCreate,     setShowCreate]    = useState(false);

  async function fetchTickets() {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/v1/tickets/");
      setTickets(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTickets(); }, []);

  const columns = (Object.values(TicketStatus) as TicketStatus[]).map(status => ({
    status,
    ...TICKET_STATUS_CONFIG[status],
    tickets: tickets.filter(t => t.status === status),
  }));

  return (
    <div>
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <p className="text-sm text-muted-foreground">共 {tickets.length} 个工单</p>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTickets}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
            title="刷新"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground
                       rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={15} />
            新建工单
          </button>
        </div>
      </div>

      {/* 看板区域 */}
      <div className="overflow-x-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            加载中...
          </div>
        ) : (
          <div className="flex gap-4 min-w-max pb-4">
            {columns.map(col => (
              <div key={col.status} className="w-72 flex-shrink-0">
                {/* 列标题 */}
                <div className={`flex items-center justify-between mb-3 px-3 py-2 rounded-lg ${col.bgColor}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                    <span className={`text-sm font-medium ${col.textColor}`}>{col.label}</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full bg-background/60 ${col.textColor}`}>
                    {col.tickets.length}
                  </span>
                </div>

                {/* 工单卡片 */}
                <div className="space-y-3">
                  {col.tickets.map(t => (
                    <TicketCard key={t.id} ticket={t} onClick={() => setSelected(t)} />
                  ))}
                  {col.tickets.length === 0 && (
                    <div className="text-center text-xs text-muted-foreground py-10
                                    border border-dashed border-border rounded-xl">
                      暂无工单
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建工单弹窗 */}
      {showCreate && (
        <TicketModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); fetchTickets(); }}
        />
      )}

      {/* 编辑工单弹窗 */}
      {selectedTicket && (
        <TicketModal
          mode="edit"
          ticket={selectedTicket}
          userRole={session?.user?.role}
          onClose={() => setSelected(null)}
          onSuccess={() => { setSelected(null); fetchTickets(); }}
        />
      )}
    </div>
  );
}
