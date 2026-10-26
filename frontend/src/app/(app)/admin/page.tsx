"use client";

import {
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AISettings from "@/components/admin/ai-settings";
import AppLogs from "@/components/admin/app-logs";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";

type Tab = "users" | "configs" | "api-tester" | "ai" | "logs";

// ── 类型 ──────────────────────────────────────────────────────
interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}
interface Config {
  key: string;
  value: string;
  description: string;
}

const ROLE_LABELS: Record<string, string> = {
  developer: "Developer",
  leader: "Leader",
  engineer: "Engineer",
};
const ROLE_COLORS: Record<string, string> = {
  developer:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  leader: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  engineer:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

export default function AdminPage() {
  const t = useUiTranslations();

  const { data: session } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("users");
  const [logRequestId, setLogRequestId] = useState("");

  // 非开发者重定向
  useEffect(() => {
    if (session && session.user.role !== "developer") router.push("/");
  }, [session, router]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "users", label: t("ui.userManagement"), icon: <Users size={15} /> },
    {
      key: "configs",
      label: t("ui.systemSettings"),
      icon: <Settings size={15} />,
    },
    {
      key: "ai",
      label: t("ui.aiServicesAndRouting"),
      icon: <Settings size={15} />,
    },
    {
      key: "logs",
      label: t("ui.applicationLogs"),
      icon: <Terminal size={15} />,
    },
    {
      key: "api-tester",
      label: t("ui.apiTesting"),
      icon: <Terminal size={15} />,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold">{t("ui.administration")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("ui.developersOnly")}
        </p>
      </div>

      {/* Tab 切换 */}
      <div className="border-border mb-6 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground border-transparent"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "configs" && <ConfigsTab />}
      {tab === "ai" && (
        <AISettings
          onInspectRequest={(id) => {
            setLogRequestId(id);
            setTab("logs");
          }}
        />
      )}
      {tab === "logs" && <AppLogs initialRequestId={logRequestId} />}
      {tab === "api-tester" && <ApiTesterTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 用户管理 Tab
// ══════════════════════════════════════════════════════════════
function UsersTab() {
  const locale = useLocale();

  const t = useUiTranslations();
  const localizedROLE_LABELS = translateLabels(ROLE_LABELS, t);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditing] = useState<UserItem | null>(null);

  async function fetchUsers() {
    setLoading(true);
    try {
      const r = await apiClient.get("/api/v1/admin/users");
      setUsers(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    fetchUsers();
  }, []);

  async function toggleActive(u: UserItem) {
    await apiClient.patch(`/api/v1/admin/users/${u.id}`, {
      is_active: !u.is_active,
    });
    fetchUsers();
  }
  async function deleteUser(u: UserItem) {
    if (!confirm(t("dynamic.deleteUser", { p0: u.name }))) return;
    await apiClient.delete(`/api/v1/admin/users/${u.id}`);
    fetchUsers();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {t("ui.total2")}
          {users.length} {t("ui.users")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={fetchUsers}
            className="hover:bg-muted/50 text-muted-foreground rounded-lg p-2"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors"
          >
            <Plus size={14} /> {t("ui.createUser")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex justify-center py-20">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {[
                  t("ui.name"),
                  t("ui.email"),
                  t("ui.role"),
                  t("ui.status"),
                  t("ui.registered"),
                  t("ui.actions"),
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="text-muted-foreground px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[u.role]}`}
                    >
                      {localizedROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(u)}
                      className={`cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                        u.is_active
                          ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {u.is_active ? t("ui.enable") : t("ui.disable")}
                    </button>
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {new Date(u.created_at).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing(u)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title={t("ui.edit")}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => deleteUser(u)}
                        className="text-muted-foreground transition-colors hover:text-red-500"
                        title={t("ui.delete")}
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

      {showCreate && (
        <UserFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            fetchUsers();
          }}
        />
      )}
      {editingUser && (
        <UserFormModal
          mode="edit"
          user={editingUser}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}

// ── 用户表单弹窗 ──────────────────────────────────────────────
function UserFormModal({
  mode,
  user,
  onClose,
  onSuccess,
}: {
  mode: "create" | "edit";
  user?: UserItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useUiTranslations();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState(user?.role ?? "engineer");
  const [password, setPassword] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      if (mode === "create") {
        if (!password || password.length < 6) {
          setError(t("ui.passwordMustBeAtLeast6Characters"));
          return;
        }
        await apiClient.post("/api/v1/admin/users", {
          name,
          email,
          role,
          password,
        });
      } else {
        await apiClient.patch(`/api/v1/admin/users/${user!.id}`, {
          name,
          role,
        });
        if (newPwd) {
          if (newPwd.length < 6) {
            setError(t("ui.newPasswordMustBeAtLeast6Characters"));
            return;
          }
          await apiClient.post(
            `/api/v1/admin/users/${user!.id}/reset-password`,
            { new_password: newPwd },
          );
        }
      }
      onSuccess();
    } catch (e: unknown) {
      setError(errorMessage(e, t("ui.operationFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border-border w-full max-w-md rounded-2xl border shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-semibold">
            {mode === "create" ? t("ui.createUser") : t("ui.editUser")}
          </h2>
          <button onClick={onClose}>
            <X size={18} className="text-muted-foreground" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("ui.name")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder={t("ui.userName")}
            />
          </div>
          {mode === "create" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("ui.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="user@example.com"
              />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("ui.role")}
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputCls}
            >
              <option value="engineer">{t("ui.engineer")}</option>
              <option value="leader">{t("ui.leader")}</option>
              <option value="developer">{t("ui.developer")}</option>
            </select>
          </div>
          {mode === "create" ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("ui.initialPassword")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder={t("ui.atLeast6Characters")}
              />
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("ui.resetPasswordLeaveBlankToKeepCurrent")}
              </label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className={inputCls}
                placeholder={t("ui.enterANewPassword")}
              />
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500 dark:bg-red-950/30">
              {error}
            </p>
          )}
        </div>
        <div className="border-border flex justify-end gap-3 border-t px-6 py-4">
          <button
            onClick={onClose}
            className="border-border hover:bg-muted/50 rounded-lg border px-4 py-2 text-sm"
          >
            {t("ui.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {mode === "create" ? t("ui.create") : t("ui.save")}
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
  const t = useUiTranslations();

  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get("/api/v1/admin/configs")
      .then((r) => setConfigs(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function saveConfig(key: string) {
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/admin/configs/${key}`, { value: editVal });
      setConfigs((prev) =>
        prev.map((c) => (c.key === key ? { ...c, value: editVal } : c)),
      );
      setEditing(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <div className="text-muted-foreground flex justify-center py-20">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );

  return (
    <div className="border-border overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {[
              t("ui.setting"),
              t("ui.currentValue"),
              t("ui.description"),
              t("ui.actions"),
            ].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {configs.map((c) => (
            <tr key={c.key} className="hover:bg-muted/20">
              <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
                {c.key}
              </td>
              <td className="px-4 py-3">
                {editing === c.key ? (
                  <input
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    className="border-border bg-muted/30 focus:ring-primary/40 w-48 rounded border px-2 py-1 text-sm focus:ring-1 focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <span className="font-medium">{c.value}</span>
                )}
              </td>
              <td className="text-muted-foreground px-4 py-3 text-xs">
                {c.description}
              </td>
              <td className="px-4 py-3">
                {editing === c.key ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveConfig(c.key)}
                      disabled={saving}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {saving ? t("ui.saving") : t("ui.save")}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="border-border hover:bg-muted/50 rounded border px-2 py-1 text-xs"
                    >
                      {t("ui.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditing(c.key);
                      setEditVal(c.value);
                    }}
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
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
  const t = useUiTranslations();

  const { data: session } = useSession();
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("/api/v1/health");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const PRESETS = [
    {
      label: t("ui.healthCheck"),
      method: "GET",
      url: "/api/v1/health",
      body: "",
    },
    {
      label: t("ui.ticketList"),
      method: "GET",
      url: "/api/v1/tickets/",
      body: "",
    },
    {
      label: t("ui.ticketStatistics"),
      method: "GET",
      url: "/api/v1/tickets/stats",
      body: "",
    },
    {
      label: t("ui.documentList"),
      method: "GET",
      url: "/api/v1/knowledge/",
      body: "",
    },
    {
      label: t("ui.userList"),
      method: "GET",
      url: "/api/v1/admin/users",
      body: "",
    },
    {
      label: t("ui.systemSettings"),
      method: "GET",
      url: "/api/v1/admin/configs",
      body: "",
    },
    { label: "AI TODO", method: "GET", url: "/api/v1/ai/todos", body: "" },
    {
      label: t("ui.aiChat"),
      method: "POST",
      url: "/api/v1/ai/chat",
      body: t("ui.messageHelloPleaseIntroduceYourself"),
    },
  ];

  async function handleSend() {
    setLoading(true);
    setResponse("");
    setStatus(null);
    setElapsed(null);
    const t0 = Date.now();
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
      const res = await fetch(fullUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.accessToken ?? ""}`,
        },
        body:
          ["POST", "PUT", "PATCH"].includes(method) && body ? body : undefined,
      });
      setStatus(res.status);
      setElapsed(Date.now() - t0);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream")) {
        setResponse(t("ui.sseResponseUseTheAiAssistantPanel"));
      } else {
        try {
          setResponse(JSON.stringify(await res.json(), null, 2));
        } catch {
          setResponse(await res.text());
        }
      }
    } catch (e: unknown) {
      setResponse(`Error: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const statusColor = status
    ? status < 300
      ? "text-green-500"
      : status < 500
        ? "text-amber-500"
        : "text-red-500"
    : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* 预设 */}
      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          {t("ui.quickPresets")}
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setMethod(p.method);
                setUrl(p.url);
                setBody(p.body);
              }}
              className="border-border hover:bg-muted/50 rounded-lg border px-2.5 py-1 text-xs transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 请求行 */}
      <div className="flex gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="border-border bg-muted/30 focus:ring-primary/30 w-28 rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
        >
          {["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border-border bg-muted/30 focus:ring-primary/30 flex-1 rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
          placeholder="/api/v1/..."
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm transition-colors disabled:opacity-50"
        >
          {loading && <Loader2 size={13} className="animate-spin" />}
          {t("ui.send")}
        </button>
      </div>

      {/* Body */}
      {["POST", "PUT", "PATCH"].includes(method) && (
        <div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            {t("ui.additionalRequestBodyJSON")}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="border-border bg-muted/30 focus:ring-primary/30 w-full resize-none rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
            placeholder='{"key": "value"}'
          />
        </div>
      )}

      {/* 响应 */}
      {(response || status) && (
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className={`font-mono text-sm font-bold ${statusColor}`}>
              {status ?? "—"}
            </span>
            {elapsed !== null && (
              <span className="text-muted-foreground text-xs">
                {elapsed} ms
              </span>
            )}
          </div>
          <pre className="bg-muted/40 border-border max-h-96 overflow-auto rounded-xl border p-4 font-mono text-xs break-all whitespace-pre-wrap">
            {response}
          </pre>
        </div>
      )}
    </div>
  );
}
