"use client";

import { errorMessage } from "@/lib/errors";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, Settings, Terminal, Loader2, Trash2, Edit2, Plus, X, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api";

type Tab = "users" | "configs" | "api-tester";

// ── 类型 ──────────────────────────────────────────────────────
interface UserItem {
  id: string; name: string; email: string;
  role: string; is_active: boolean; created_at: string;
}
interface Config { key: string; value: string; description: string; }

const ROLE_LABELS: Record<string, string> = {
  developer: "开发者", leader: "领导", engineer: "工程师",
};
const ROLE_COLORS: Record<string, string> = {
  developer: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  leader:    "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  engineer:  "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("users");

  // 非开发者重定向
  useEffect(() => {
    if (session && session.user.role !== "developer") router.push("/");
  }, [session, router]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "users",      label: "用户管理", icon: <Users size={15} /> },
    { key: "configs",    label: "系统配置", icon: <Settings size={15} /> },
    { key: "api-tester", label: "API 测试", icon: <Terminal size={15} /> },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">管理后台</h1>
        <p className="text-sm text-muted-foreground mt-1">仅开发者可访问</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium
                        border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === "users"      && <UsersTab />}
      {tab === "configs"    && <ConfigsTab />}
      {tab === "api-tester" && <ApiTesterTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 用户管理 Tab
// ══════════════════════════════════════════════════════════════
function UsersTab() {
  const [users,       setUsers]      = useState<UserItem[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [showCreate,  setShowCreate] = useState(false);
  const [editingUser, setEditing]    = useState<UserItem | null>(null);

  async function fetchUsers() {
    setLoading(true);
    try { const r = await apiClient.get("/api/v1/admin/users"); setUsers(r.data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }
  useEffect(() => { fetchUsers(); }, []);

  async function toggleActive(u: UserItem) {
    await apiClient.patch(`/api/v1/admin/users/${u.id}`, { is_active: !u.is_active });
    fetchUsers();
  }
  async function deleteUser(u: UserItem) {
    if (!confirm(`确定删除用户 ${u.name}？`)) return;
    await apiClient.delete(`/api/v1/admin/users/${u.id}`);
    fetchUsers();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">共 {users.length} 名用户</p>
        <div className="flex gap-2">
          <button onClick={fetchUsers} className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary
                       text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> 新建用户
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["姓名", "邮箱", "角色", "状态", "注册时间", "操作"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(u)}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer
                                  transition-colors ${
                        u.is_active
                          ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {u.is_active ? "启用" : "禁用"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(u.created_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing(u)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="编辑"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => deleteUser(u)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate  && <UserFormModal mode="create" onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); fetchUsers(); }} />}
      {editingUser && <UserFormModal mode="edit" user={editingUser} onClose={() => setEditing(null)} onSuccess={() => { setEditing(null); fetchUsers(); }} />}
    </div>
  );
}

// ── 用户表单弹窗 ──────────────────────────────────────────────
function UserFormModal({
  mode, user, onClose, onSuccess,
}: { mode: "create" | "edit"; user?: UserItem; onClose: () => void; onSuccess: () => void }) {
  const [name,     setName]     = useState(user?.name     ?? "");
  const [email,    setEmail]    = useState(user?.email    ?? "");
  const [role,     setRole]     = useState(user?.role     ?? "engineer");
  const [password, setPassword] = useState("");
  const [newPwd,   setNewPwd]   = useState("");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  async function handleSave() {
    setError(""); setSaving(true);
    try {
      if (mode === "create") {
        if (!password || password.length < 6) { setError("密码至少 6 位"); return; }
        await apiClient.post("/api/v1/admin/users", { name, email, role, password });
      } else {
        await apiClient.patch(`/api/v1/admin/users/${user!.id}`, { name, role });
        if (newPwd) {
          if (newPwd.length < 6) { setError("新密码至少 6 位"); return; }
          await apiClient.post(`/api/v1/admin/users/${user!.id}/reset-password`, { new_password: newPwd });
        }
      }
      onSuccess();
    } catch (e: unknown) {
      setError(errorMessage(e, "操作失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold">{mode === "create" ? "新建用户" : "编辑用户"}</h2>
          <button onClick={onClose}><X size={18} className="text-muted-foreground" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">姓名</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="用户姓名" />
          </div>
          {mode === "create" && (
            <div>
              <label className="block text-sm font-medium mb-1.5">邮箱</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="user@example.com" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">角色</label>
            <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
              <option value="engineer">工程师</option>
              <option value="leader">领导</option>
              <option value="developer">开发者</option>
            </select>
          </div>
          {mode === "create" ? (
            <div>
              <label className="block text-sm font-medium mb-1.5">初始密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="至少 6 位" />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1.5">重置密码（留空则不修改）</label>
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className={inputCls} placeholder="输入新密码" />
            </div>
          )}
          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted/50">取消</button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 系统配置 Tab
// ══════════════════════════════════════════════════════════════
function ConfigsTab() {
  const [configs,  setConfigs]  = useState<Config[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState<string | null>(null);
  const [editVal,  setEditVal]  = useState("");
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    apiClient.get("/api/v1/admin/configs")
      .then(r => setConfigs(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function saveConfig(key: string) {
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/admin/configs/${key}`, { value: editVal });
      setConfigs(prev => prev.map(c => c.key === key ? { ...c, value: editVal } : c));
      setEditing(null);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-20 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>{["配置项", "当前值", "说明", "操作"].map(h => (
            <th key={h} className="px-4 py-3 text-left font-medium text-xs">{h}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {configs.map(c => (
            <tr key={c.key} className="hover:bg-muted/20">
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.key}</td>
              <td className="px-4 py-3">
                {editing === c.key ? (
                  <input
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    className="px-2 py-1 rounded border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 w-48"
                    autoFocus
                  />
                ) : (
                  <span className="font-medium">{c.value}</span>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground text-xs">{c.description}</td>
              <td className="px-4 py-3">
                {editing === c.key ? (
                  <div className="flex gap-2">
                    <button onClick={() => saveConfig(c.key)} disabled={saving}
                      className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
                      {saving ? "保存中..." : "保存"}
                    </button>
                    <button onClick={() => setEditing(null)} className="text-xs px-2 py-1 border border-border rounded hover:bg-muted/50">取消</button>
                  </div>
                ) : (
                  <button onClick={() => { setEditing(c.key); setEditVal(c.value); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Edit2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// API 测试 Tab
// ══════════════════════════════════════════════════════════════
function ApiTesterTab() {
  const { data: session } = useSession();
  const [method,   setMethod]   = useState("GET");
  const [url,      setUrl]      = useState("/api/v1/health");
  const [body,     setBody]     = useState("");
  const [response, setResponse] = useState("");
  const [status,   setStatus]   = useState<number | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [elapsed,  setElapsed]  = useState<number | null>(null);

  const PRESETS = [
    { label: "健康检查",   method: "GET",  url: "/api/v1/health",         body: "" },
    { label: "工单列表",   method: "GET",  url: "/api/v1/tickets/",        body: "" },
    { label: "工单统计",   method: "GET",  url: "/api/v1/tickets/stats",   body: "" },
    { label: "知识库列表", method: "GET",  url: "/api/v1/knowledge/",      body: "" },
    { label: "用户列表",   method: "GET",  url: "/api/v1/admin/users",     body: "" },
    { label: "系统配置",   method: "GET",  url: "/api/v1/admin/configs",   body: "" },
    { label: "AI TODO",   method: "GET",  url: "/api/v1/ai/todos",        body: "" },
    { label: "AI 问答",    method: "POST", url: "/api/v1/ai/chat",         body: '{"message":"你好，请介绍一下自己"}' },
  ];

  async function handleSend() {
    setLoading(true); setResponse(""); setStatus(null); setElapsed(null);
    const t0 = Date.now();
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
      const res = await fetch(fullUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.accessToken ?? ""}`,
        },
        body: ["POST", "PUT", "PATCH"].includes(method) && body ? body : undefined,
      });
      setStatus(res.status);
      setElapsed(Date.now() - t0);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream")) {
        setResponse("[SSE 流式响应，请在 AI 助手面板中使用]");
      } else {
        try { setResponse(JSON.stringify(await res.json(), null, 2)); }
        catch { setResponse(await res.text()); }
      }
    } catch (e: unknown) {
      setResponse(`Error: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const statusColor = status
    ? status < 300 ? "text-green-500" : status < 500 ? "text-amber-500" : "text-red-500"
    : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* 预设 */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">快速预设：</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { setMethod(p.method); setUrl(p.url); setBody(p.body); }}
              className="text-xs px-2.5 py-1 border border-border rounded-lg hover:bg-muted/50 transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 请求行 */}
      <div className="flex gap-2">
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono
                     focus:outline-none focus:ring-2 focus:ring-primary/30 w-28">
          {["GET","POST","PATCH","PUT","DELETE"].map(m => <option key={m}>{m}</option>)}
        </select>
        <input value={url} onChange={e => setUrl(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono
                     focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="/api/v1/..." />
        <button onClick={handleSend} disabled={loading}
          className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg
                     hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-1.5">
          {loading && <Loader2 size={13} className="animate-spin" />}
          发送
        </button>
      </div>

      {/* Body */}
      {["POST","PUT","PATCH"].includes(method) && (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">Request Body (JSON)</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
            className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono
                       focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            placeholder='{"key": "value"}' />
        </div>
      )}

      {/* 响应 */}
      {(response || status) && (
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-sm font-mono font-bold ${statusColor}`}>
              {status ?? "—"}
            </span>
            {elapsed !== null && (
              <span className="text-xs text-muted-foreground">{elapsed} ms</span>
            )}
          </div>
          <pre className="bg-muted/40 border border-border rounded-xl p-4 text-xs font-mono
                          overflow-auto max-h-96 whitespace-pre-wrap break-all">
            {response}
          </pre>
        </div>
      )}
    </div>
  );
}
