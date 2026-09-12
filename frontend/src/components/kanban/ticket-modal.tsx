"use client";

import { useEffect, useState } from "react";
import { X, Trash2, Send, Loader2 } from "lucide-react";
import apiClient from "@/lib/api";
import {
  Ticket, TicketComment, TicketStatus, TicketPriority,
  TICKET_STATUS_CONFIG, TICKET_PRIORITY_CONFIG,
} from "@/types/ticket";

interface FormState {
  title:            string;
  description:      string;
  customer_name:    string;
  customer_contact: string;
  product_name:     string;
  firmware_version: string;
  priority:         TicketPriority;
  status:           TicketStatus;
  tags:             string; // 逗号分隔
}

interface Props {
  mode:      "create" | "edit";
  ticket?:   Ticket;
  userRole?: string;
  onClose:   () => void;
  onSuccess: () => void;
}

export default function TicketModal({ mode, ticket, userRole, onClose, onSuccess }: Props) {
  const isEdit = mode === "edit";

  const [tab,            setTab]           = useState<"details" | "comments" | "ai">("details");
  const [form,           setForm]          = useState<FormState>({
    title:            ticket?.title            ?? "",
    description:      ticket?.description      ?? "",
    customer_name:    ticket?.customer_name    ?? "",
    customer_contact: ticket?.customer_contact ?? "",
    product_name:     ticket?.product_name     ?? "",
    firmware_version: ticket?.firmware_version ?? "",
    priority:         ticket?.priority         ?? TicketPriority.medium,
    status:           ticket?.status           ?? TicketStatus.open,
    tags:             ticket?.tags?.join(", ") ?? "",
  });
  const [comments,       setComments]      = useState<TicketComment[]>([]);
  const [newComment,     setNewComment]    = useState("");
  const [submitting,     setSubmitting]    = useState(false);
  const [deleting,       setDeleting]      = useState(false);
  const [sendingComment, setSending]       = useState(false);
  const [analyzing,      setAnalyzing]    = useState(false);
  const [aiAnalysis,     setAiAnalysis]   = useState(ticket?.ai_analysis ?? "");

  // 编辑模式：拉取完整工单数据（含评论）
  useEffect(() => {
    if (isEdit && ticket) {
      apiClient.get(`/api/v1/tickets/${ticket.id}`).then(res => {
        setComments(res.data.comments ?? []);
      }).catch(console.error);
    }
  }, [isEdit, ticket]);

  // 点 ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function setField(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        title:            form.title.trim(),
        description:      form.description      || null,
        customer_name:    form.customer_name     || null,
        customer_contact: form.customer_contact  || null,
        product_name:     form.product_name      || null,
        firmware_version: form.firmware_version  || null,
        priority:         form.priority,
        tags: form.tags
          ? form.tags.split(",").map(t => t.trim()).filter(Boolean)
          : null,
        ...(isEdit && { status: form.status }),
      };

      if (isEdit) {
        await apiClient.patch(`/api/v1/tickets/${ticket!.id}`, payload);
      } else {
        await apiClient.post("/api/v1/tickets/", payload);
      }
      onSuccess();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`确定删除工单 ${ticket?.ticket_no}？此操作不可恢复。`)) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/v1/tickets/${ticket!.id}`);
      onSuccess();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddComment() {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const res = await apiClient.post(`/api/v1/tickets/${ticket!.id}/comments`, {
        content: newComment.trim(),
        is_internal: false,
      });
      setComments(prev => [...prev, res.data]);
      setNewComment("");
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  const canDelete = isEdit && (userRole === "developer" || userRole === "leader");

  // ── 表单字段公共样式 ──────────────────────────────────────
  const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl
                      max-h-[90vh] flex flex-col">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-base">
              {isEdit ? ticket?.ticket_no : "新建工单"}
            </h2>
            {isEdit && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ticket?.title}</p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-4 flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* ── Tabs（仅编辑模式） ──────────────────────────── */}
        {isEdit && (
          <div className="flex border-b border-border px-6">
            {(["details", "comments", "ai"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === t
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "details" ? "详情" : t === "comments" ? `评论 (${comments.length})` : "🤖 AI 分析"}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* 详情 Tab */}
          {tab === "details" && (
            <div className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  标题 <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={e => setField("title", e.target.value)}
                  placeholder="请输入工单标题"
                  className={inputCls}
                />
              </div>

              {/* 状态 + 优先级 */}
              <div className={`grid gap-4 ${isEdit ? "grid-cols-2" : "grid-cols-1"}`}>
                {isEdit && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">状态</label>
                    <select
                      value={form.status}
                      onChange={e => setField("status", e.target.value)}
                      className={inputCls}
                    >
                      {(Object.values(TicketStatus) as TicketStatus[]).map(s => (
                        <option key={s} value={s}>{TICKET_STATUS_CONFIG[s].label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1.5">优先级</label>
                  <select
                    value={form.priority}
                    onChange={e => setField("priority", e.target.value)}
                    className={inputCls}
                  >
                    {(Object.values(TicketPriority) as TicketPriority[]).map(p => (
                      <option key={p} value={p}>{TICKET_PRIORITY_CONFIG[p].label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">问题描述</label>
                <textarea
                  value={form.description}
                  onChange={e => setField("description", e.target.value)}
                  placeholder="请详细描述客户反馈的问题..."
                  rows={3}
                  className={`${inputCls} resize-none`}
                />
              </div>

              {/* 客户信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">客户名称</label>
                  <input value={form.customer_name} onChange={e => setField("customer_name", e.target.value)} placeholder="客户公司名" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">联系方式</label>
                  <input value={form.customer_contact} onChange={e => setField("customer_contact", e.target.value)} placeholder="邮箱或电话" className={inputCls} />
                </div>
              </div>

              {/* 产品信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">产品型号</label>
                  <input value={form.product_name} onChange={e => setField("product_name", e.target.value)} placeholder="产品名称" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">固件版本</label>
                  <input value={form.firmware_version} onChange={e => setField("firmware_version", e.target.value)} placeholder="v1.0.0" className={inputCls} />
                </div>
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">标签</label>
                <input
                  value={form.tags}
                  onChange={e => setField("tags", e.target.value)}
                  placeholder="多个标签用逗号分隔，如：网络, 固件, 硬件"
                  className={inputCls}
                />
              </div>

              {/* 元信息（编辑模式） */}
              {isEdit && (
                <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                  创建人：{ticket?.creator.name} · {new Date(ticket!.created_at).toLocaleString("zh-CN")}
                </p>
              )}
            </div>
          )}

          {/* AI 分析 Tab */}
          {tab === "ai" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  AI 将结合知识库内容分析工单，给出排查建议。
                </p>
                <button
                  onClick={async () => {
                    setAnalyzing(true);
                    try {
                      const res = await apiClient.post(`/api/v1/ai/analyze-ticket/${ticket!.id}`);
                      setAiAnalysis(res.data.analysis);
                    } catch (e) { console.error(e); }
                    finally { setAnalyzing(false); }
                  }}
                  disabled={analyzing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary
                             text-primary-foreground rounded-lg hover:bg-primary/90
                             disabled:opacity-50 transition-colors flex-shrink-0 ml-3"
                >
                  {analyzing
                    ? <><Loader2 size={13} className="animate-spin" /> 分析中...</>
                    : "▶ 开始分析"}
                </button>
              </div>
              {aiAnalysis ? (
                <div className="bg-muted/40 rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {aiAnalysis}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 border border-dashed
                                border-border rounded-xl text-sm text-muted-foreground">
                  {analyzing ? "AI 正在分析，请稍候..." : "点击「开始分析」生成 AI 排查建议"}
                </div>
              )}
            </div>
          )}

          {/* 评论 Tab */}
          {tab === "comments" && (
            <div className="flex flex-col gap-4">
              {/* 评论列表 */}
              <div className="space-y-3 flex-1">
                {comments.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-10">暂无评论</p>
                ) : comments.map(c => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center
                                    text-xs font-semibold text-primary flex-shrink-0">
                      {c.author.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium">{c.author.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleString("zh-CN")}
                        </span>
                        {c.is_internal && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded
                                           dark:bg-amber-950/50 dark:text-amber-400">
                            内部
                          </span>
                        )}
                      </div>
                      <p className="text-sm bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">
                        {c.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 添加评论 */}
              <div className="flex gap-2 pt-3 border-t border-border">
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                  placeholder="添加评论... (Enter 发送)"
                  className={`flex-1 ${inputCls}`}
                />
                <button
                  onClick={handleAddComment}
                  disabled={sendingComment || !newComment.trim()}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-lg
                             hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {sendingComment ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer（仅详情 Tab 显示） ───────────────────── */}
        {tab === "details" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <div>
              {canDelete && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600
                             disabled:opacity-50 transition-colors"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  删除工单
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-border rounded-lg
                           hover:bg-muted/50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !form.title.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground
                           rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? "保存更改" : "创建工单"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
