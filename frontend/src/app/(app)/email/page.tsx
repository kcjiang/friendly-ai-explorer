"use client";

import { errorMessage } from "@/lib/errors";

import { useEffect, useState } from "react";
import {
  Mail, RefreshCw, Settings, X, Loader2, CheckCircle,
  AlertTriangle, Clock, ChevronRight, Inbox, ListTodo,
  Check, XCircle, Edit2,
} from "lucide-react";
import apiClient from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────
interface EmailAccount {
  id: string; email_address: string; imap_host: string;
  imap_port: number; username: string; is_active: boolean; use_ssl: boolean;
  last_synced_at: string | null;
}
interface SyncedEmail {
  id: string; subject: string | null; sender: string | null;
  body_text: string | null; received_at: string | null;
  is_analyzed: boolean; ai_is_customer_email: boolean | null;
  ai_is_defect_report: boolean | null; ai_summary: string | null;
}
interface PreTicket {
  id: string; email_id: string; title: string; description: string | null;
  customer_name: string | null; customer_contact: string | null;
  product_name: string | null; firmware_version: string | null;
  priority: string; status: string; created_ticket_id: string | null;
  email_subject: string | null; email_sender: string | null;
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700", low: "bg-green-100 text-green-700",
};
const STATUS_COLORS: Record<string, string> = {
  pending_review: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-slate-100 text-slate-500",
};
const STATUS_LABELS: Record<string, string> = {
  pending_review: "待审核", approved: "已批准", rejected: "已拒绝",
};

// ═══════════════════════════════════════════════════════════════
export default function EmailPage() {
  const [account,      setAccount]  = useState<EmailAccount | null | undefined>(undefined);
  const [emails,       setEmails]   = useState<SyncedEmail[]>([]);
  const [preTickets,   setPTs]      = useState<PreTicket[]>([]);
  const [selected,     setSelected] = useState<SyncedEmail | null>(null);
  const [tab,          setTab]      = useState<"inbox" | "pretickets">("inbox");
  const [showSetup,    setSetup]    = useState(false);
  const [syncLimit,    setLimit]    = useState(50);
  const [syncing,      setSyncing]  = useState(false);
  const [syncResult,   setSyncRes]  = useState<string>("");

  async function loadAccount()    { const r = await apiClient.get("/api/v1/email/account"); setAccount(r.data); }
  async function loadEmails()     { const r = await apiClient.get("/api/v1/email/emails"); setEmails(r.data); }
  async function loadPreTickets() { const r = await apiClient.get("/api/v1/email/pre-tickets"); setPTs(r.data); }

  useEffect(() => {
    loadAccount().catch(() => setAccount(null));
  }, []);

  useEffect(() => {
    if (account) { loadEmails(); loadPreTickets(); }
  }, [account]);

  async function handleSync() {
    setSyncing(true); setSyncRes("");
    try {
      const r = await apiClient.post("/api/v1/email/sync", { limit: syncLimit });
      setSyncRes(`✅ 新增 ${r.data.synced} 封，分析 ${r.data.analyzed} 封，生成预工单 ${r.data.pre_tickets_created} 个`);
      await loadEmails(); await loadPreTickets();
    } catch (e: unknown) {
      setSyncRes(`❌ ${errorMessage(e, "同步失败")}`);
    } finally { setSyncing(false); }
  }

  async function deleteAccount() {
    if (!confirm("确定删除邮件账号？同步的邮件也会一并删除。")) return;
    await apiClient.delete("/api/v1/email/account");
    setAccount(null); setEmails([]); setPTs([]);
  }

  // ── 未配置账号 ────────────────────────────────────────────
  if (account === undefined) {
    return <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 size={20} className="animate-spin mr-2" />加载中...</div>;
  }

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="bg-background border border-border rounded-2xl p-8 shadow-lg max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mx-auto">
            <Mail size={28} className="text-white" />
          </div>
          <h2 className="text-lg font-bold">配置邮件账号</h2>
          <p className="text-sm text-muted-foreground">通过 IMAP 连接你的邮箱，AI 将自动识别客户缺陷报告并生成工单</p>
          <button onClick={() => setSetup(true)}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            配置 IMAP 账号
          </button>
        </div>
        {showSetup && <AccountSetupModal onClose={() => setSetup(false)} onSuccess={a => { setAccount(a); setSetup(false); }} />}
      </div>
    );
  }

  // ── 主界面 ────────────────────────────────────────────────
  const pendingPTs = preTickets.filter(p => p.status === "pending_review").length;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail size={14} />
          <span className="font-medium text-foreground">{account.email_address}</span>
          {account.last_synced_at && (
            <span>· 上次同步 {new Date(account.last_synced_at).toLocaleString("zh-CN")}</span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">同步数量:</span>
            <input type="number" min={1} value={syncLimit === 0 ? "" : syncLimit}
              onChange={e => setLimit(e.target.value === "" ? 0 : parseInt(e.target.value) || 50)}
              placeholder="∞"
              className="w-20 px-2 py-1 rounded-lg border border-border bg-muted/30 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {syncing ? "同步中..." : "同步"}
          </button>
          <button onClick={() => setSetup(true)} title="账号设置"
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors">
            <Settings size={15} />
          </button>
        </div>
        {syncResult && (
          <div className="w-full text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-lg">
            {syncResult}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-4">
        {[
          { key: "inbox", label: "收件箱", icon: <Inbox size={13} />, count: emails.length },
          { key: "pretickets", label: "预创建工单", icon: <ListTodo size={13} />, count: pendingPTs },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
            className={`flex items-center gap-1.5 py-2.5 px-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t.icon} {t.label}
            {t.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "inbox" ? (
          <InboxView emails={emails} selected={selected} onSelect={setSelected} />
        ) : (
          <PreTicketsView preTickets={preTickets} onRefresh={loadPreTickets} />
        )}
      </div>

      {showSetup && (
        <AccountSetupModal
          existing={account}
          onClose={() => setSetup(false)}
          onSuccess={a => { setAccount(a); setSetup(false); }}
          onDelete={deleteAccount}
        />
      )}
    </div>
  );
}

// ── 收件箱视图 ────────────────────────────────────────────────
function InboxView({ emails, selected, onSelect }: {
  emails: SyncedEmail[]; selected: SyncedEmail | null; onSelect: (e: SyncedEmail) => void;
}) {
  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Mail size={40} className="mb-3 opacity-30" />
        <p className="text-sm">暂无邮件，点击&quot;同步&quot;拉取最新邮件</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 邮件列表 */}
      <div className="w-80 flex-shrink-0 border-r border-border overflow-y-auto">
        {emails.map(e => {
          const isSelected = selected?.id === e.id;
          let badge = null;
          if (!e.is_analyzed) badge = <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex items-center gap-1"><Clock size={10} />分析中</span>;
          else if (e.ai_is_defect_report) badge = <span className="text-xs bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 px-1.5 py-0.5 rounded flex items-center gap-1"><AlertTriangle size={10} />缺陷报告</span>;
          else if (e.ai_is_customer_email) badge = <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-1"><CheckCircle size={10} />客户邮件</span>;
          else if (e.is_analyzed) badge = <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">普通邮件</span>;

          return (
            <div key={e.id} onClick={() => onSelect(e)}
              className={`px-4 py-3 cursor-pointer border-b border-border transition-colors ${
                isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"
              }`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-medium truncate flex-1">{e.subject || "(无主题)"}</p>
                <ChevronRight size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
              </div>
              <p className="text-xs text-muted-foreground truncate mb-1.5">{e.sender}</p>
              {badge && <div>{badge}</div>}
              {e.received_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(e.received_at).toLocaleString("zh-CN")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* 邮件预览 */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <div className="space-y-4 max-w-3xl">
            <h2 className="text-lg font-bold">{selected.subject || "(无主题)"}</h2>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground border-b border-border pb-3">
              <span><strong>发件人：</strong>{selected.sender}</span>
              {selected.received_at && <span><strong>时间：</strong>{new Date(selected.received_at).toLocaleString("zh-CN")}</span>}
            </div>

            {/* AI 分析结果 */}
            {selected.is_analyzed && (
              <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  🤖 AI 分析结果
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className={`text-xs px-2 py-1 rounded-lg font-medium ${selected.ai_is_customer_email ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                    {selected.ai_is_customer_email ? "✓ 客户邮件" : "✗ 非客户邮件"}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-lg font-medium ${selected.ai_is_defect_report ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>
                    {selected.ai_is_defect_report ? "⚠ 缺陷报告" : "✓ 非缺陷报告"}
                  </span>
                </div>
                {selected.ai_summary && <p className="text-sm text-muted-foreground">{selected.ai_summary}</p>}
                {selected.ai_is_defect_report && (
                  <p className="text-xs text-green-600 dark:text-green-400">已自动生成预创建工单，请切换到「预创建工单」Tab 审核。</p>
                )}
              </div>
            )}

            {/* 邮件正文 */}
            <div className="text-sm leading-relaxed whitespace-pre-wrap bg-background border border-border rounded-xl p-4 max-h-96 overflow-y-auto">
              {selected.body_text || "(正文为空)"}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Mail size={40} className="mb-3 opacity-30" />
            <p className="text-sm">选择一封邮件预览</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 预创建工单视图 ────────────────────────────────────────────
function PreTicketsView({ preTickets, onRefresh }: { preTickets: PreTicket[]; onRefresh: () => void; }) {
  const [editing, setEditing] = useState<PreTicket | null>(null);
  const [loading, setLoading] = useState<string>("");

  async function handleApprove(pt: PreTicket) {
    setLoading(pt.id);
    try {
      const r = await apiClient.post(`/api/v1/email/pre-tickets/${pt.id}/approve`);
      alert(`✅ 工单已创建：${r.data.ticket_no}`);
      onRefresh();
    } catch (e: unknown) { alert(errorMessage(e, "操作失败")); }
    finally { setLoading(""); }
  }

  async function handleReject(pt: PreTicket) {
    if (!confirm("确定拒绝此预工单？")) return;
    setLoading(pt.id);
    try { await apiClient.post(`/api/v1/email/pre-tickets/${pt.id}/reject`); onRefresh(); }
    catch (e: unknown) { alert(errorMessage(e)); }
    finally { setLoading(""); }
  }

  if (preTickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <ListTodo size={40} className="mb-3 opacity-30" />
        <p className="text-sm">暂无预创建工单</p>
        <p className="text-xs mt-1">同步邮件后，AI 识别到缺陷报告将自动在此生成</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <p className="text-sm text-muted-foreground">共 {preTickets.length} 个预工单，
        <span className="text-primary font-medium">{preTickets.filter(p => p.status === "pending_review").length}</span> 个待审核</p>

      {preTickets.map(pt => (
        <div key={pt.id} className={`bg-background border rounded-xl p-4 transition-colors ${
          pt.status === "approved" ? "border-green-200 dark:border-green-900" :
          pt.status === "rejected" ? "border-border opacity-60" : "border-border"
        }`}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {/* 状态 + 优先级 */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pt.status] ?? ""}`}>
                  {STATUS_LABELS[pt.status]}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[pt.priority] ?? ""}`}>
                  {pt.priority}
                </span>
                {pt.created_ticket_id && (
                  <span className="text-xs text-green-600 dark:text-green-400">工单已创建</span>
                )}
              </div>

              <h3 className="font-semibold text-sm mb-1">{pt.title}</h3>
              <p className="text-xs text-muted-foreground mb-2 truncate">
                来源邮件：{pt.email_subject || "—"} · 发件人：{pt.email_sender || "—"}
              </p>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {pt.customer_name    && <span>客户：{pt.customer_name}</span>}
                {pt.customer_contact && <span>联系：{pt.customer_contact}</span>}
                {pt.product_name     && <span>产品：{pt.product_name}</span>}
                {pt.firmware_version && <span>固件：{pt.firmware_version}</span>}
              </div>

              {pt.description && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{pt.description}</p>
              )}
            </div>

            {/* 操作按钮 */}
            {pt.status === "pending_review" && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setEditing(pt)} title="编辑"
                  className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleApprove(pt)} disabled={loading === pt.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors">
                  {loading === pt.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  批准
                </button>
                <button onClick={() => handleReject(pt)} disabled={loading === pt.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted/50 disabled:opacity-50 transition-colors text-muted-foreground">
                  <XCircle size={12} /> 拒绝
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {editing && (
        <EditPreTicketModal
          pt={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => { setEditing(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── 账号设置弹窗 ──────────────────────────────────────────────
function AccountSetupModal({ existing, onClose, onSuccess, onDelete }: {
  existing?: EmailAccount | null; onClose: () => void;
  onSuccess: (a: EmailAccount) => void; onDelete?: () => void;
}) {
  const [form, setForm] = useState({
    email_address: existing?.email_address ?? "",
    imap_host:     existing?.imap_host     ?? "",
    imap_port:     existing?.imap_port     ?? 993,
    username:      existing?.username      ?? "",
    password:      "",
    use_ssl:       existing?.use_ssl       ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const PRESETS = [
    { label: "Gmail",        host: "imap.gmail.com",        port: 993 },
    { label: "Outlook",      host: "outlook.office365.com", port: 993 },
    { label: "QQ邮箱",       host: "imap.qq.com",           port: 993 },
    { label: "163邮箱",      host: "imap.163.com",          port: 993 },
    { label: "企业微信邮箱", host: "imap.exmail.qq.com",    port: 993 },
  ];

  async function handleSave() {
    if (!form.password && !existing) { setError("请输入密码"); return; }
    setSaving(true); setError("");
    try {
      const r = await apiClient.post("/api/v1/email/account", form);
      onSuccess(r.data);
    } catch (e: unknown) { setError(errorMessage(e, "连接失败，请检查配置")); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold">IMAP 账号配置</h2>
          <button onClick={onClose}><X size={18} className="text-muted-foreground" /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* 快速预设 */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">快速填充常用邮箱配置：</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => setForm(f => ({ ...f, imap_host: p.host, imap_port: p.port }))}
                  className="text-xs px-2.5 py-1 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div><label className="block text-sm font-medium mb-1.5">邮件地址</label>
            <input value={form.email_address} onChange={e => setForm(f => ({ ...f, email_address: e.target.value }))} className={inputCls} placeholder="your@email.com" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="block text-sm font-medium mb-1.5">IMAP 服务器</label>
              <input value={form.imap_host} onChange={e => setForm(f => ({ ...f, imap_host: e.target.value }))} className={inputCls} placeholder="imap.example.com" /></div>
            <div><label className="block text-sm font-medium mb-1.5">端口</label>
              <input type="number" value={form.imap_port} onChange={e => setForm(f => ({ ...f, imap_port: parseInt(e.target.value) }))} className={inputCls} /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1.5">用户名（通常为邮件地址）</label>
            <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1.5">密码 / 应用专用密码{existing ? "（留空则不修改）" : ""}</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={inputCls} placeholder="••••••••" /></div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={form.use_ssl} onChange={e => setForm(f => ({ ...f, use_ssl: e.target.checked }))} className="accent-primary" />
            使用 SSL/TLS（推荐）
          </label>
          <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            💡 Gmail 用户：需在 Google 账号设置中开启「应用专用密码」，不支持直接使用 Google 账号密码。
          </p>
          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div>
            {existing && onDelete && (
              <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-600 transition-colors">删除账号</button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted/50">取消</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? "连接测试中..." : "保存并连接"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 编辑预工单弹窗 ────────────────────────────────────────────
function EditPreTicketModal({ pt, onClose, onSuccess }: {
  pt: PreTicket; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    title:            pt.title,
    description:      pt.description ?? "",
    customer_name:    pt.customer_name ?? "",
    customer_contact: pt.customer_contact ?? "",
    product_name:     pt.product_name ?? "",
    firmware_version: pt.firmware_version ?? "",
    priority:         pt.priority,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/email/pre-tickets/${pt.id}`, form);
      onSuccess();
    } catch (e: unknown) { alert(errorMessage(e)); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold">编辑预工单</h2>
          <button onClick={onClose}><X size={18} className="text-muted-foreground" /></button>
        </div>
        <div className="p-6 space-y-3">
          <div><label className="block text-sm font-medium mb-1.5">标题</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} /></div>
          <div><label className="block text-sm font-medium mb-1.5">优先级</label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
              {["critical","high","medium","low"].map(p => <option key={p} value={p}>{p}</option>)}
            </select></div>
          <div><label className="block text-sm font-medium mb-1.5">问题描述</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className={`${inputCls} resize-none`} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">客户名称</label>
              <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className={inputCls} /></div>
            <div><label className="block text-sm font-medium mb-1.5">联系方式</label>
              <input value={form.customer_contact} onChange={e => setForm(f => ({ ...f, customer_contact: e.target.value }))} className={inputCls} /></div>
            <div><label className="block text-sm font-medium mb-1.5">产品型号</label>
              <input value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} className={inputCls} /></div>
            <div><label className="block text-sm font-medium mb-1.5">固件版本</label>
              <input value={form.firmware_version} onChange={e => setForm(f => ({ ...f, firmware_version: e.target.value }))} className={inputCls} /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted/50">取消</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} 保存
          </button>
        </div>
      </div>
    </div>
  );
}
