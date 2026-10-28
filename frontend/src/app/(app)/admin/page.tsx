"use client";

import {
  ArrowUpDown,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AISettings from "@/components/admin/ai-settings";
import AppLogs from "@/components/admin/app-logs";
import {
  useAdminChanges,
  useAdminLeave,
} from "@/components/admin/unsaved-changes";
import Container from "@/components/container";
import PageToolbar from "@/components/page-toolbar";
import { Badge } from "@/components/ui/base/badge";
import { Button } from "@/components/ui/base/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import { Input } from "@/components/ui/base/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/base/input-group";
import { Label } from "@/components/ui/base/label";
import { NativeSelect } from "@/components/ui/base/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/base/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/base/tabs";
import { Textarea } from "@/components/ui/base/textarea";
import { useFeedback } from "@/components/ui/feedback-provider";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import { adminRequestUrl, validateUserDraft } from "@/lib/admin-request";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";

type Tab = "users" | "api-tester" | "ai" | "logs";

// ── 类型 ──────────────────────────────────────────────────────
interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
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

const inputCls = "w-full";

export default function AdminPage() {
  const t = useUiTranslations();
  const { data: session } = useSession();
  const router = useRouter();
  const canLeave = useAdminLeave();
  const [tab, setTab] = useState<Tab>("users");
  const [logRequestId, setLogRequestId] = useState("");

  // 非开发者重定向
  useEffect(() => {
    if (session && session.user.role !== "developer") router.push("/");
  }, [session, router]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "users", label: t("ui.userManagement"), icon: <Users size={15} /> },
    {
      key: "ai",
      label: t("ui.aiServicesAndRouting"),
      icon: <Settings size={15} />,
    },
    {
      key: "logs",
      label: t("ui.systemLogs"),
      icon: <Terminal size={15} />,
    },
    {
      key: "api-tester",
      label: t("ui.apiTesting"),
      icon: <Terminal size={15} />,
    },
  ];

  return (
    <div className="min-h-full min-w-0">
      <Tabs
        value={tab}
        onValueChange={async (value) => {
          if (value !== tab && (await canLeave())) setTab(value as Tab);
        }}
      >
        <PageToolbar label={t("ui.administration")}>
          <div className="flex max-w-full min-w-0 overflow-x-auto overflow-y-hidden">
            <TabsList aria-label={t("ui.administration")}>
              {tabs.map((item) => (
                <TabsTrigger key={item.key} value={item.key}>
                  {item.icon}
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <p className="text-muted-foreground ml-auto text-xs">
            {t("ui.developersOnly")}
          </p>
        </PageToolbar>
        <Container className="min-w-0 py-6">
          <TabsContent value="users" className="mt-0">
            <UsersTab />
          </TabsContent>
          <TabsContent value="ai" className="mt-0">
            <AISettings
              onInspectRequest={async (id) => {
                if (await canLeave()) {
                  setLogRequestId(id);
                  setTab("logs");
                }
              }}
            />
          </TabsContent>
          <TabsContent value="logs" className="mt-0">
            <AppLogs initialRequestId={logRequestId} />
          </TabsContent>
          <TabsContent value="api-tester" className="mt-0">
            <ApiTesterTab />
          </TabsContent>
        </Container>
      </Tabs>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 用户管理 Tab
// ══════════════════════════════════════════════════════════════
function UsersTab() {
  const { confirm } = useFeedback();

  const locale = useLocale();

  const t = useUiTranslations();
  const localizedROLE_LABELS = translateLabels(ROLE_LABELS, t);

  const chinese = locale === "zh-CN";
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<keyof UserItem>("created_at");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyUser, setBusyUser] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditing] = useState<UserItem | null>(null);

  const fetchUsers = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const r = await apiClient.get("/api/v1/admin/users");
      setUsers(r.data);
    } catch (e) {
      setError(errorMessage(e, t("ui.operationFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  async function mutateUser(u: UserItem, remove = false) {
    if (busyUser) return;
    if (remove && !(await confirm(t("dynamic.deleteUser", { p0: u.name }))))
      return;
    setBusyUser(u.id);
    setError("");
    setNotice("");
    try {
      if (remove) await apiClient.delete(`/api/v1/admin/users/${u.id}`);
      else
        await apiClient.patch(`/api/v1/admin/users/${u.id}`, {
          is_active: !u.is_active,
        });
      setNotice(t("ui.saved"));
      await fetchUsers();
    } catch (e) {
      setError(errorMessage(e, t("ui.operationFailed")));
    } finally {
      setBusyUser("");
    }
  }
  const filtered = users
    .filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter || String(u.is_active) === statusFilter) &&
        `${u.name} ${u.email}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const result = String(a[sort]).localeCompare(String(b[sort]), locale, {
        numeric: true,
      });
      return (ascending ? result : -result) || a.id.localeCompare(b.id);
    });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const displayedUsers = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const sortColumns: (keyof UserItem)[] = [
    "name",
    "email",
    "role",
    "is_active",
    "created_at",
  ];
  function changeSort(key: keyof UserItem) {
    setAscending(sort === key ? !ascending : true);
    setSort(key);
    setPage(1);
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {t("ui.total2")}
          {users.length} {t("ui.users")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void fetchUsers()}
            disabled={loading || !!busyUser}
            size="icon"
            aria-label={t("ui.refresh")}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button
            disabled={loading || !!busyUser}
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} /> {t("ui.createUser")}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="max-w-80 min-w-40 flex-1">
          <InputGroup>
            <InputGroupInput
              aria-label={chinese ? "搜索用户" : "Search users"}
              placeholder={chinese ? "搜索姓名或邮箱" : "Search name or email"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <NativeSelect
          aria-label={t("ui.role")}
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{chinese ? "全部角色" : "All roles"}</option>
          {Object.entries(localizedROLE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("ui.status")}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{chinese ? "全部状态" : "All statuses"}</option>
          <option value="true">{chinese ? "已启用" : "Active"}</option>
          <option value="false">{chinese ? "已禁用" : "Disabled"}</option>
        </NativeSelect>
      </div>
      {error && (
        <div
          role="alert"
          className="text-destructive mb-4 flex flex-wrap items-center gap-2 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !!busyUser}
            onClick={() => void fetchUsers()}
          >
            {chinese ? "重新加载" : "Reload"}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
          {notice}
        </p>
      )}
      {loading ? (
        <div className="text-muted-foreground flex justify-center py-20">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-xl border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/40 text-muted-foreground">
              <TableRow>
                {[
                  t("ui.name"),
                  t("ui.email"),
                  t("ui.role"),
                  t("ui.status"),
                  t("ui.registered"),
                  t("ui.actions"),
                ].map((h, index) => (
                  <TableHead
                    key={h}
                    aria-sort={
                      sortColumns[index] === sort
                        ? ascending
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className="px-4 py-3 text-left text-xs font-medium"
                  >
                    {sortColumns[index] ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => changeSort(sortColumns[index])}
                      >
                        {h}
                        <ArrowUpDown className="size-3" />
                      </Button>
                    ) : (
                      h
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-border divide-y">
              {displayedUsers.map((u) => (
                <TableRow
                  key={u.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <TableCell className="px-4 py-3 font-medium">
                    {u.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground px-4 py-3">
                    {u.email}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Badge variant="secondary" className={ROLE_COLORS[u.role]}>
                      {localizedROLE_LABELS[u.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Button
                      variant="outline"
                      disabled={loading || !!busyUser}
                      aria-label={`${u.is_active ? t("ui.disable") : t("ui.enable")} ${u.name}`}
                      onClick={() => void mutateUser(u)}
                      className={`cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                        u.is_active
                          ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {u.is_active
                        ? chinese
                          ? "已启用"
                          : "Active"
                        : chinese
                          ? "已禁用"
                          : "Disabled"}
                    </Button>
                  </TableCell>
                  <TableCell className="text-muted-foreground px-4 py-3 text-xs">
                    {new Date(u.created_at).toLocaleDateString(locale)}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        disabled={loading || !!busyUser}
                        aria-label={`${t("ui.edit")} ${u.name}`}
                        onClick={() => setEditing(u)}
                        size="icon-sm"
                        title={t("ui.edit")}
                      >
                        <Edit2 size={14} />
                      </Button>
                      <Button
                        variant="outline"
                        disabled={loading || !!busyUser}
                        aria-label={`${t("ui.delete")} ${u.name}`}
                        onClick={() => void mutateUser(u, true)}
                        size="icon-sm"
                        title={t("ui.delete")}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!displayedUsers.length && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground h-24 text-center"
                  >
                    {error
                      ? chinese
                        ? "用户加载失败，请重试"
                        : "Could not load users. Please retry."
                      : chinese
                        ? "没有匹配的用户"
                        : "No matching users"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {filtered.length} / {users.length} · {currentPage} / {pages}
        </span>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label={chinese ? "每页数量" : "Rows per page"}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("ui.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("ui.next")}
          </Button>
        </div>
      </div>
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
  const chinese = useLocale() === "zh-CN";
  const canLeave = useAdminLeave();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState(user?.role ?? "engineer");
  const [password, setPassword] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty =
    name !== (user?.name ?? "") ||
    email !== (user?.email ?? "") ||
    role !== (user?.role ?? "engineer") ||
    !!password ||
    !!newPwd;
  useAdminChanges("user-form", dirty);
  async function requestClose() {
    if (!saving && (await canLeave())) onClose();
  }
  async function handleSave() {
    setError("");
    const invalid = validateUserDraft(
      { name, email, role, password, newPassword: newPwd },
      mode === "create",
    );
    if (invalid) {
      setError(
        invalid === "password"
          ? t("ui.passwordMustBeAtLeast6Characters")
          : invalid === "newPassword"
            ? t("ui.newPasswordMustBeAtLeast6Characters")
            : chinese
              ? "请填写有效的姓名、邮箱和角色。"
              : "Enter a valid name, email and role.",
      );
      return;
    }
    setSaving(true);
    let profileSaved = false;
    try {
      if (mode === "create") {
        await apiClient.post("/api/v1/admin/users", {
          name: name.trim(),
          email: email.trim(),
          role,
          password,
        });
      } else {
        await apiClient.patch(`/api/v1/admin/users/${user!.id}`, {
          name: name.trim(),
          role,
        });
        profileSaved = true;
        if (newPwd) {
          await apiClient.post(
            `/api/v1/admin/users/${user!.id}/reset-password`,
            { new_password: newPwd },
          );
        }
      }
      onSuccess();
    } catch (e: unknown) {
      setError(
        profileSaved && newPwd
          ? chinese
            ? "用户资料已保存，但密码重置未完成，请重试。"
            : "User details were saved, but the password reset did not complete. Please retry."
          : errorMessage(e, t("ui.operationFailed")),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("ui.createUser") : t("ui.editUser")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-6">
          <div>
            <Label
              htmlFor="admin-user-name"
              className="mb-1.5 block text-sm font-medium"
            >
              {t("ui.name")}
            </Label>
            <Input
              id="admin-user-name"
              aria-label={t("ui.name")}
              disabled={saving}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder={t("ui.userName")}
            />
          </div>
          {mode === "create" && (
            <div>
              <Label
                htmlFor="admin-user-email"
                className="mb-1.5 block text-sm font-medium"
              >
                {t("ui.email")}
              </Label>
              <Input
                type="email"
                id="admin-user-email"
                aria-label={t("ui.email")}
                disabled={saving}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="user@example.com"
              />
            </div>
          )}
          <div>
            <Label
              htmlFor="admin-user-role"
              className="mb-1.5 block text-sm font-medium"
            >
              {t("ui.role")}
            </Label>
            <NativeSelect
              id="admin-user-role"
              aria-label={t("ui.role")}
              disabled={saving}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputCls}
            >
              <option value="engineer">{t("ui.engineer")}</option>
              <option value="leader">{t("ui.leader")}</option>
              <option value="developer">{t("ui.developer")}</option>
            </NativeSelect>
          </div>
          {mode === "create" ? (
            <div>
              <Label
                htmlFor="admin-user-password"
                className="mb-1.5 block text-sm font-medium"
              >
                {t("ui.initialPassword")}
              </Label>
              <Input
                type="password"
                id="admin-user-password"
                aria-label={t("ui.initialPassword")}
                disabled={saving}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder={t("ui.atLeast6Characters")}
              />
            </div>
          ) : (
            <div>
              <Label
                htmlFor="admin-user-newPwd"
                className="mb-1.5 block text-sm font-medium"
              >
                {t("ui.resetPasswordLeaveBlankToKeepCurrent")}
              </Label>
              <Input
                type="password"
                id="admin-user-newPwd"
                aria-label={t("ui.resetPasswordLeaveBlankToKeepCurrent")}
                disabled={saving}
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
        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void requestClose()}
            className="border-border hover:bg-muted/50 rounded-lg border px-4 py-2 text-sm"
          >
            {t("ui.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            {mode === "create" ? t("ui.create") : t("ui.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiTesterTab() {
  const t = useUiTranslations();

  const { data: session } = useSession();
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("/api/v1/admin/users");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const PRESETS = [
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
      const fullUrl = adminRequestUrl(url, window.location.origin);
      if (["POST", "PUT", "PATCH"].includes(method) && body.trim())
        JSON.parse(body);
      const res = await fetch(fullUrl, {
        method,
        redirect: "error",
        credentials: "same-origin",
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
      if (ct.includes("text/event-stream"))
        setResponse(t("ui.sseResponseUseTheAiAssistantPanel"));
      else {
        const text = await res.text();
        try {
          setResponse(JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          setResponse(text);
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
      <p className="text-muted-foreground text-sm">
        {t("ui.adminLocalApiOnly")}
      </p>
      {/* 预设 */}
      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          {t("ui.quickPresets")}
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              variant="outline"
              key={p.label}
              onClick={() => {
                setMethod(p.method);
                setUrl(p.url);
                setBody(p.body);
              }}
              className="border-border hover:bg-muted/50 rounded-lg border px-2.5 py-1 text-xs transition-colors"
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 请求行 */}
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          aria-label="HTTP method"
          disabled={loading}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="border-border bg-muted/30 focus:ring-primary/30 w-28 rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
        >
          {["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </NativeSelect>
        <Input
          aria-label="API URL"
          disabled={loading}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border-border bg-muted/30 focus:ring-primary/30 flex-1 rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
          placeholder="/api/v1/..."
        />
        <Button onClick={handleSend} disabled={loading}>
          {loading && <Loader2 size={13} className="animate-spin" />}
          {t("ui.send")}
        </Button>
      </div>

      {/* Body */}
      {["POST", "PUT", "PATCH"].includes(method) && (
        <div>
          <Label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            {t("ui.additionalRequestBodyJSON")}
          </Label>
          <Textarea
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
