"use client";

import {
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

type Account = { id: string; name: string; base_url: string; username: string };
type Task = {
  id: string;
  name: string;
  account_id: string;
  jql: string;
  enabled: boolean;
  interval_minutes: number;
  last_run_at: string | null;
  next_run_at: string;
  last_error: string | null;
};
type Template = { id: string; name: string; fields: string[] };
type Source = {
  title: string;
  description: unknown;
  url: string;
  status: string;
  priority: string;
  reporter: string;
  updated: string;
  attachments: { name: string; url: string }[];
  comments?: { author: string; body: unknown }[];
};
type Draft = {
  template_name: string;
  fields: Record<string, string>;
  field_order?: string[];
  generated_at: string;
  source_updated: string;
};
type Issue = {
  id: string;
  issue_key: string;
  source: Source;
  processed: boolean;
  draft: Draft | null;
};
type Run = {
  id: string;
  task_id: string;
  started_at: string;
  success: boolean;
  message: string;
};
type Overview = {
  accounts: Account[];
  tasks: Task[];
  templates: Template[];
  issues: Issue[];
  runs: Run[];
  default_template: Omit<Template, "id">;
};
const ROOT = "/api/v1/ai-tasks";
const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;
const panel = "rounded-xl border border-border bg-card p-5";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "尚未执行";
const text = (value: unknown) =>
  typeof value === "string"
    ? value
    : value
      ? JSON.stringify(value, null, 2)
      : "暂无描述";

export default function AITasksPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState("issues");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Issue | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [form, setForm] = useState<"account" | "task" | "template" | null>(
    null,
  );
  const [accountForm, setAccountForm] = useState({
    id: "",
    name: "",
    base_url: "https://jira.sdmctech.com:9380",
    username: "",
    password: "",
  });
  const [taskForm, setTaskForm] = useState({
    id: "",
    name: "客户 Jira 问题检查",
    account_id: "",
    jql: "project = DRACO ORDER BY created DESC",
    interval_minutes: 60,
    enabled: false,
  });
  const [templateForm, setTemplateForm] = useState({
    id: "",
    name: "",
    fields: "",
  });

  const load = useCallback(async () => {
    const response = await api.get<Overview>(ROOT);
    setData(response.data);
    setSelected((current) => {
      if (!current) return current;
      const fresh = response.data.issues.find((i) => i.id === current.id);
      return fresh
        ? { ...current, source: fresh.source, processed: fresh.processed }
        : current;
    });
    return response.data;
  }, []);
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function action(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }

  function openIssue(issue: Issue) {
    setNotice("");
    setError("");
    setSelected(issue);
    setDraft(issue.draft);
    setTemplateId("");
  }
  async function saveForm(event: FormEvent) {
    event.preventDefault();
    await action("save", async () => {
      if (form === "account") {
        const { id, ...body } = accountForm;
        await api.request({
          method: id ? "PUT" : "POST",
          url: `${ROOT}/accounts${id ? "/" + id : ""}`,
          data: { ...body, password: body.password || null },
        });
        setAccountForm({
          id: "",
          name: "",
          base_url: "https://jira.sdmctech.com:9380",
          username: "",
          password: "",
        });
      } else if (form === "task") {
        const { id, ...body } = taskForm;
        await api.request({
          method: id ? "PUT" : "POST",
          url: `${ROOT}/tasks${id ? "/" + id : ""}`,
          data: body,
        });
      } else if (form === "template") {
        const { id, name, fields } = templateForm;
        await api.request({
          method: id ? "PUT" : "POST",
          url: `${ROOT}/templates${id ? "/" + id : ""}`,
          data: { name, fields: fields.split("\n").filter((v) => v.trim()) },
        });
      }
      setForm(null);
      setNotice("已保存");
    });
  }
  async function saveDraft() {
    if (!selected || !draft) return;
    await api.put(`${ROOT}/issues/${selected.id}/draft`, {
      fields: draft.fields,
    });
    setSelected({ ...selected, draft });
  }
  const draftEntries: [string, string][] = draft
    ? (
        draft.field_order ??
        (draft.template_name === data?.default_template.name
          ? data.default_template.fields
          : Object.keys(draft.fields))
      ).map((key) => [key, draft.fields[key] ?? ""])
    : [];
  const pending = data?.issues.filter((i) => !i.processed).length ?? 0;
  const issues =
    data?.issues.filter(
      (i) =>
        (filter === "all" ||
          (filter === "processed" ? i.processed : !i.processed)) &&
        `${i.issue_key} ${i.source.title}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const tabs = [
    { id: "issues", label: "问题收件箱", icon: FileText },
    { id: "tasks", label: "检查任务", icon: Clock3 },
    { id: "accounts", label: "托管账户", icon: KeyRound },
    { id: "templates", label: "缺陷模板", icon: Bot },
    { id: "runs", label: "执行记录", icon: CheckCircle2 },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Bot size={24} />
            </div>
            <h1 className="text-2xl font-semibold">AI任务</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            连接客户平台，发现新问题，整理为可提交的缺陷草稿。
          </p>
        </div>
        <button
          className={button}
          disabled={!!busy}
          onClick={() =>
            action("refresh", async () => {
              await load();
            })
          }
        >
          <RefreshCw
            size={15}
            className={busy === "refresh" ? "animate-spin" : ""}
          />
          刷新
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "待处理问题", value: pending, color: "text-amber-600" },
          {
            label: "已处理问题",
            value: data?.issues.filter((i) => i.processed).length ?? 0,
            color: "text-emerald-600",
          },
          {
            label: "定时检查任务",
            value: data?.tasks.filter((t) => t.enabled).length ?? 0,
            color: "text-primary",
          },
          {
            label: "托管 Jira 账户",
            value: data?.accounts.length ?? 0,
            color: "text-primary",
          },
        ].map((s) => (
          <div key={s.label} className={panel}>
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className={`mt-2 text-3xl font-semibold ${s.color}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-600"
        >
          <span>{error}</span>
          <button aria-label="关闭错误" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-600"
        >
          {notice}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon size={16} />
            {t.label}
            {t.id === "issues" && pending > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 text-xs text-amber-600">
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="p-12 text-center text-muted-foreground">
          {error ? (
            "暂时无法加载，请刷新重试。"
          ) : (
            <Loader2 className="mx-auto animate-spin" />
          )}
        </div>
      ) : (
        <>
          {tab === "issues" && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div className="flex gap-2">
                  {[
                    { id: "pending", label: "待处理" },
                    { id: "processed", label: "已处理" },
                    { id: "all", label: "全部" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      className={filter === f.id ? primary : button}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <input
                  aria-label="搜索问题"
                  placeholder="搜索问题编号或标题…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`${input} max-w-xs`}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                “导入”生成草稿，复制后请在 TAPD
                提交，再点击“标记已处理”。首次扫描的未处理问题都会高亮。
              </p>
              {!issues.length ? (
                <div className={`${panel} py-14 text-center`}>
                  <FileText
                    className="mx-auto mb-3 text-muted-foreground"
                    size={30}
                  />
                  <p>
                    {data.tasks.length
                      ? "当前没有匹配的问题"
                      : "从创建第一个检查任务开始"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    添加 Jira 账户后，配置项目或 JQL，手动检查或开启定时任务。
                  </p>
                  <button
                    className={`${button} mt-4`}
                    onClick={() =>
                      setTab(data.accounts.length ? "tasks" : "accounts")
                    }
                  >
                    前往{data.accounts.length ? "检查任务" : "托管账户"}
                  </button>
                </div>
              ) : (
                issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 ${issue.processed ? "border-border bg-card" : "border-amber-400/50 bg-amber-500/5"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <a
                          href={issue.source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-sm font-medium text-primary"
                        >
                          {issue.issue_key}
                          <ExternalLink size={12} />
                        </a>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${issue.processed ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}
                        >
                          {issue.processed ? "已处理" : "待处理"}
                        </span>
                        {issue.draft && (
                          <span className="text-xs text-muted-foreground">
                            已有草稿
                          </span>
                        )}
                      </div>
                      <p className="mt-2 font-medium">{issue.source.title}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {issue.source.status} · {issue.source.priority} ·{" "}
                        {issue.source.reporter} · 更新于{" "}
                        {date(issue.source.updated)}
                      </p>
                    </div>
                    <button
                      className={issue.draft ? button : primary}
                      onClick={() => openIssue(issue)}
                    >
                      <FileText size={15} />
                      {issue.draft ? "查看草稿" : "导入"}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
          {tab === "accounts" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  密码加密保存，仅用于后台访问 Jira。
                </p>
                <button
                  className={primary}
                  onClick={() => {
                    setAccountForm({
                      id: "",
                      name: "",
                      base_url: "https://jira.sdmctech.com:9380",
                      username: "",
                      password: "",
                    });
                    setForm("account");
                  }}
                >
                  <Plus size={16} />
                  添加账户
                </button>
              </div>
              {!data.accounts.length && (
                <div className={`${panel} text-center text-muted-foreground`}>
                  尚未托管账户，添加 Jira 账户后可测试连接。
                </div>
              )}
              {data.accounts.map((a) => (
                <div
                  key={a.id}
                  className={`${panel} flex flex-wrap items-center justify-between gap-4`}
                >
                  <div>
                    <p className="font-medium">
                      {a.name}
                      <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        Jira
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {a.base_url}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.username} · 密码已加密保存
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className={button}
                      disabled={!!busy}
                      onClick={() =>
                        action(`test-${a.id}`, async () => {
                          const r = await api.post(
                            `${ROOT}/accounts/${a.id}/test`,
                          );
                          setNotice(r.data.message);
                        })
                      }
                    >
                      测试连接
                    </button>
                    <button
                      className={button}
                      onClick={() => {
                        setAccountForm({ ...a, password: "" });
                        setForm("account");
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className={`${button} text-red-600`}
                      disabled={!!busy}
                      onClick={() => {
                        if (confirm("删除此托管账户？已发现问题和草稿会保留。"))
                          action("delete", async () => {
                            await api.delete(`${ROOT}/accounts/${a.id}`);
                          });
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "tasks" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  按项目或 JQL 检查；定时任务在服务端执行。
                </p>
                <button
                  className={primary}
                  disabled={!data.accounts.length}
                  onClick={() => {
                    setTaskForm({
                      id: "",
                      name: "客户 Jira 问题检查",
                      account_id: data.accounts[0]?.id || "",
                      jql: "project = DRACO ORDER BY created DESC",
                      interval_minutes: 60,
                      enabled: false,
                    });
                    setForm("task");
                  }}
                >
                  <Plus size={16} />
                  创建任务
                </button>
              </div>
              {!data.accounts.length && (
                <p className={`${panel} text-sm text-muted-foreground`}>
                  请先在“托管账户”添加 Jira 账户。
                </p>
              )}
              {data.tasks.map((t) => (
                <div key={t.id} className={panel}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {t.name}
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs ${t.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                        >
                          {t.enabled
                            ? `每 ${t.interval_minutes} 分钟`
                            : "仅手动执行"}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {data.accounts.find((a) => a.id === t.account_id)?.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={primary}
                        disabled={!!busy}
                        onClick={() =>
                          action(t.id, async () => {
                            const r = await api.post(
                              `${ROOT}/tasks/${t.id}/run`,
                              {},
                              { timeout: 270000 },
                            );
                            if (!r.data.success)
                              throw new Error(r.data.message);
                            setNotice(r.data.message);
                          })
                        }
                      >
                        {busy === t.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Play size={15} />
                        )}
                        立即检查
                      </button>
                      <button
                        className={button}
                        disabled={!!busy}
                        onClick={() =>
                          action("toggle", async () => {
                            await api.put(`${ROOT}/tasks/${t.id}`, {
                              ...t,
                              enabled: !t.enabled,
                            });
                          })
                        }
                      >
                        {t.enabled ? "暂停定时" : "开启定时"}
                      </button>
                      <button
                        className={button}
                        onClick={() => {
                          setTaskForm(t);
                          setForm("task");
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className={`${button} text-red-600`}
                        disabled={!!busy}
                        onClick={() => {
                          if (confirm("删除任务？已发现问题和草稿仍会保留。"))
                            action("delete", async () => {
                              await api.delete(`${ROOT}/tasks/${t.id}`);
                            });
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <pre className="my-4 overflow-auto rounded-lg bg-muted/50 p-3 text-xs">
                    {t.jql}
                  </pre>
                  <p className="text-xs text-muted-foreground">
                    上次执行：{date(t.last_run_at)}
                    {t.enabled && ` · 下次执行：${date(t.next_run_at)}`}
                  </p>
                  {t.last_error && (
                    <p className="mt-2 text-sm text-red-600">{t.last_error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === "templates" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  每行一个字段，AI 会按字段整理，并留空缺失信息。
                </p>
                <button
                  className={primary}
                  onClick={() => {
                    setTemplateForm({
                      id: "",
                      name: "",
                      fields: data.default_template.fields.join("\n"),
                    });
                    setForm("template");
                  }}
                >
                  <Plus size={16} />
                  新增模板
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {[{ ...data.default_template, id: "" }, ...data.templates].map(
                  (t) => (
                    <div key={t.id} className={panel}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-medium">{t.name}</h3>
                        {t.id ? (
                          <div className="flex gap-2">
                            <button
                              className={button}
                              onClick={() => {
                                setTemplateForm({
                                  ...t,
                                  fields: t.fields.join("\n"),
                                });
                                setForm("template");
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className={`${button} text-red-600`}
                              disabled={!!busy}
                              onClick={() => {
                                if (confirm("删除模板？已有草稿不受影响。"))
                                  action("delete", async () => {
                                    await api.delete(
                                      `${ROOT}/templates/${t.id}`,
                                    );
                                  });
                              }}
                            >
                              删除
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            内置模板
                          </span>
                        )}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {t.fields.map((f) => (
                          <span
                            key={f}
                            className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
          {tab === "runs" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                最近 50 次执行记录 · 时间按浏览器本地时区显示
              </p>
              {!data.runs.length && (
                <div className={`${panel} text-muted-foreground`}>
                  暂无执行记录
                </div>
              )}
              {data.runs.map((r) => (
                <div key={r.id} className={`${panel} flex items-start gap-3`}>
                  <span
                    className={r.success ? "text-emerald-600" : "text-red-600"}
                  >
                    {r.success ? <CheckCircle2 size={18} /> : <X size={18} />}
                  </span>
                  <div>
                    <p className="text-sm">{r.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {data.tasks.find((t) => t.id === r.task_id)?.name} ·{" "}
                      {date(r.started_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {form && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="form-title"
        >
          <form
            onSubmit={saveForm}
            className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-auto rounded-2xl border border-border bg-background p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 id="form-title" className="text-lg font-semibold">
                {form === "account"
                  ? "托管 Jira 账户"
                  : form === "task"
                    ? "配置检查任务"
                    : "缺陷模板"}
              </h2>
              <button
                type="button"
                aria-label="关闭"
                disabled={!!busy}
                onClick={() => setForm(null)}
              >
                <X size={20} />
              </button>
            </div>
            {form === "account" && (
              <>
                <label className="block space-y-1 text-sm">
                  <span>账户名称</span>
                  <input
                    required
                    maxLength={150}
                    className={input}
                    value={accountForm.name}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, name: e.target.value })
                    }
                    placeholder="例如：客户 Jira"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Jira 站点地址</span>
                  <input
                    type="url"
                    required
                    className={input}
                    value={accountForm.base_url}
                    onChange={(e) =>
                      setAccountForm({
                        ...accountForm,
                        base_url: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>用户名</span>
                  <input
                    required
                    autoComplete="off"
                    className={input}
                    value={accountForm.username}
                    onChange={(e) =>
                      setAccountForm({
                        ...accountForm,
                        username: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>密码{accountForm.id && "（留空保留原密码）"}</span>
                  <input
                    required={!accountForm.id}
                    type="password"
                    autoComplete="new-password"
                    className={input}
                    value={accountForm.password}
                    onChange={(e) =>
                      setAccountForm({
                        ...accountForm,
                        password: e.target.value,
                      })
                    }
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  仅支持 HTTPS。保存后可测试连接，密码不会回显，也不会发送给
                  AI。
                </p>
              </>
            )}
            {form === "task" && (
              <>
                <label className="block space-y-1 text-sm">
                  <span>任务名称</span>
                  <input
                    required
                    maxLength={150}
                    className={input}
                    value={taskForm.name}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, name: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>托管账户</span>
                  <select
                    required
                    className={input}
                    value={taskForm.account_id}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, account_id: e.target.value })
                    }
                  >
                    {data?.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>JQL 筛选条件</span>
                  <textarea
                    required
                    rows={4}
                    className={`${input} font-mono`}
                    value={taskForm.jql}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, jql: e.target.value })
                    }
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  按项目：project = DRACO；指定问题：key in (DRACO-35,
                  DRACO-30)；已保存筛选器：filter = 12345
                </p>
                <label className="block space-y-1 text-sm">
                  <span>检查间隔（分钟，最少 5）</span>
                  <input
                    required
                    type="number"
                    min={5}
                    max={10080}
                    className={input}
                    value={taskForm.interval_minutes}
                    onChange={(e) =>
                      setTaskForm({
                        ...taskForm,
                        interval_minutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={taskForm.enabled}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, enabled: e.target.checked })
                    }
                  />
                  开启定时执行（保存后首次尽快执行）
                </label>
              </>
            )}
            {form === "template" && (
              <>
                <label className="block space-y-1 text-sm">
                  <span>模板名称</span>
                  <input
                    required
                    maxLength={150}
                    className={input}
                    value={templateForm.name}
                    onChange={(e) =>
                      setTemplateForm({ ...templateForm, name: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>模板字段（每行一个）</span>
                  <textarea
                    required
                    rows={12}
                    className={input}
                    value={templateForm.fields}
                    onChange={(e) =>
                      setTemplateForm({
                        ...templateForm,
                        fields: e.target.value,
                      })
                    }
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={!!busy}
                className={button}
                onClick={() => setForm(null)}
              >
                取消
              </button>
              <button disabled={!!busy} className={primary}>
                {busy === "save" && (
                  <Loader2 className="animate-spin" size={15} />
                )}
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
        >
          <div className="flex h-full w-full max-w-5xl flex-col border-l border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <h2 id="preview-title" className="text-lg font-semibold">
                  {selected.issue_key} · 缺陷导入预览
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  生成草稿不会标记已处理；红色字段需要补充。
                </p>
              </div>
              <button
                aria-label="关闭预览"
                disabled={!!busy}
                onClick={() => {
                  if (
                    JSON.stringify(draft) !== JSON.stringify(selected.draft) &&
                    !confirm("存在未保存修改，确认关闭？")
                  )
                    return;
                  setSelected(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="max-h-72 space-y-4 overflow-auto pr-2 lg:max-h-none">
                  <h3 className="font-medium">客户原始问题</h3>
                  <a
                    className="inline-flex items-center gap-1 text-sm text-primary"
                    href={selected.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开 Jira <ExternalLink size={13} />
                  </a>
                  <p className="font-medium">{selected.source.title}</p>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm">
                    {text(selected.source.description)}
                  </pre>
                  {selected.source.attachments.map((a, idx) => (
                    <a
                      className="block break-all text-xs text-primary"
                      key={idx}
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.name}
                    </a>
                  ))}
                  {selected.source.comments?.map((c, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg bg-muted/40 p-3 text-sm"
                    >
                      <p className="mb-2 text-xs text-muted-foreground">
                        {c.author}
                      </p>
                      <p className="whitespace-pre-wrap">{text(c.body)}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="选择转换模板"
                      className={`${input} min-w-0 flex-1`}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      <option value="">{data?.default_template.name}</option>
                      {data?.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className={primary}
                      disabled={!!busy}
                      onClick={() => {
                        if (
                          draft &&
                          !confirm("重新转换会覆盖当前草稿，是否继续？")
                        )
                          return;
                        action("convert", async () => {
                          const r = await api.post<Draft>(
                            `${ROOT}/issues/${selected.id}/convert`,
                            { template_id: templateId || null },
                            { timeout: 650000 },
                          );
                          setDraft(r.data);
                          const fresh = await load();
                          setSelected(
                            fresh.issues.find((i) => i.id === selected.id) ||
                              selected,
                          );
                        });
                      }}
                    >
                      {busy === "convert" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Bot size={15} />
                      )}
                      {draft ? "重新转换" : "AI 转换"}
                    </button>
                  </div>
                  {draft ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {draft.template_name} · {date(draft.generated_at)}
                      </p>
                      {draft.source_updated !== selected.source.updated && (
                        <p className="text-sm text-amber-600">
                          Jira 在草稿生成后有更新，请检查原文并按需重新转换。
                        </p>
                      )}
                      {draftEntries.map(([key, value]) => (
                        <label key={key} className="block space-y-1 text-sm">
                          <span
                            className={`font-medium ${!value.trim() ? "text-red-600" : ""}`}
                          >
                            {key}：
                            {!value.trim() && (
                              <span className="ml-2 text-xs">待补充</span>
                            )}
                          </span>
                          <textarea
                            rows={key === "客户缺陷原始描述" ? 5 : 3}
                            className={`${input} ${!value.trim() ? "border-red-400 bg-red-500/5" : ""}`}
                            value={value}
                            placeholder="来源信息缺失，请补充"
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                fields: {
                                  ...draft.fields,
                                  [key]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                      选择模板后点击“AI 转换”，生成可编辑的 TAPD 草稿。
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-3 border-t border-border p-4">
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-emerald-600">
                  {notice}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className={button}
                  disabled={!draft || !!busy}
                  onClick={() =>
                    action("draft", async () => {
                      await saveDraft();
                      setNotice("草稿已保存");
                    })
                  }
                >
                  <Check size={15} />
                  保存草稿
                </button>
                <button
                  className={button}
                  disabled={!draft || !!busy}
                  onClick={() =>
                    action("copy", async () => {
                      if (!draft) return;
                      await saveDraft();
                      await navigator.clipboard.writeText(
                        draftEntries
                          .map(
                            ([k, v]) =>
                              `**${k}：**\n${v.trim() || "【待补充】"}`,
                          )
                          .join("\n\n") + `\n\n来源：${selected.source.url}`,
                      );
                      setNotice("已复制，请在 TAPD 提交后标记已处理");
                    })
                  }
                >
                  <Copy size={15} />
                  复制内容
                </button>
                <button
                  className={primary}
                  disabled={!draft || !!busy}
                  onClick={() =>
                    action("processed", async () => {
                      await saveDraft();
                      const r = await api.patch<Issue>(
                        `${ROOT}/issues/${selected.id}/processed`,
                        { processed: !selected.processed },
                      );
                      setSelected(r.data);
                      setNotice(
                        r.data.processed ? "已标记处理完成" : "已恢复待处理",
                      );
                    })
                  }
                >
                  <CheckCircle2 size={15} />
                  {selected.processed ? "恢复待处理" : "标记已处理"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
