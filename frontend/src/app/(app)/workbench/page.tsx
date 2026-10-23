"use client";

import {
  ArrowDown,
  ArrowUp,
  Clock3,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  Terminal,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CatalogCombobox,
  ConfirmDialog,
} from "@/components/catalog/catalog-ui";
import { SearchSelect } from "@/components/catalog/search-select";
import Container from "@/components/container";
import { TopNav } from "@/components/nav";
import {
  Alert,
  AlertAction,
  AlertDescription,
} from "@/components/ui/base/alert";
import { Badge } from "@/components/ui/base/badge";
import { Button } from "@/components/ui/base/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/base/card";
import { Checkbox } from "@/components/ui/base/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/base/empty";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/base/field";
import { Input } from "@/components/ui/base/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/base/native-select";
import { ScrollArea } from "@/components/ui/base/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/base/tabs";
import { Textarea } from "@/components/ui/base/textarea";
import { WorkbenchDebugConsole } from "@/components/workbench/debug-console";
import {
  type CardKind,
  CardList,
  DragCard,
  WorkbenchDragCards,
} from "@/components/workbench/drag-cards";
import { HistoryRecords } from "@/components/workbench/history-records";
import { WorkbenchPanel } from "@/components/workbench/panel";
import { TimezoneSelect } from "@/components/workbench/timezone-select";
import { usePolling } from "@/hooks/use-polling";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type {
  Account,
  Automation,
  Message,
  Overview,
  Schedule,
  Step,
} from "@/types/workbench";
import type { MailOverview } from "@/types/workbench-mail";
import styles from "./workbench.module.css";

const MailWindow = dynamic(
  () =>
    import("@/components/workbench/mail-window").then(
      (module) => module.MailWindow,
    ),
  { ssr: false },
);
const endpoint = "/api/v1/workbench";
const stepLabels: Record<Step["type"], string> = {
  read: "读取消息与人工补充",
  ai: "AI 整理",
  map: "字段映射",
  ticket: "写入 Ticket",
  result: "记录执行结果",
};
const platforms = { jira: "Jira", youtrack: "YouTrack" };
const defaultAccount = {
  name: "",
  platform: "jira" as Account["platform"],
  base_url: "",
  username: "",
  password: "",
  project_id: "",
  mail_folder_id: "",
  enabled: true,
};
type AccountDraft = typeof defaultAccount & { id?: string };
type DialogState =
  | { type: "schedule" }
  | { type: "account"; account?: Account }
  | { type: "automation"; automation?: Automation }
  | { type: "message"; message: Message }
  | { type: "history"; automation: Automation };

function dates(period: string) {
  const current = new Date(),
    from = new Date(current);
  from.setHours(0, 0, 0, 0);
  if (period === "week")
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  if (period === "month") from.setDate(from.getDate() - 29);
  return { since: from.toISOString(), until: current.toISOString() };
}
function dateTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleString([], {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未执行";
}
function safeUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : undefined;
}

export default function WorkbenchPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [period, setPeriod] = useState("week");
  const [selected, setSelected] = useState("");
  const [messageState, setMessageState] = useState("pending");
  const [mailOpen, setMailOpen] = useState(false);
  const [mailMounted, setMailMounted] = useState(false);
  function openMailbox() {
    setMailMounted(true);
    setMailOpen(true);
  }
  const [linkedMail, setLinkedMail] = useState<string | undefined>();
  const [mailData, setMailData] = useState<MailOverview | null>(null);
  const reloadMail = useCallback((signal?: AbortSignal) => {
    return api
      .get<MailOverview>(`${endpoint}/mail`, { signal })
      .then((r) => {
        if (!signal?.aborted) setMailData(r.data);
      })
      .catch((e) => {
        if (!signal?.aborted) setError(errorMessage(e));
      });
  }, []);
  const [mailPolling, setMailPolling] = useState(8000);
  usePolling(reloadMail, mailPolling, !mailOpen);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  function openDialog(value: DialogState) {
    setDialog(value);
    setDialogOpen(true);
  }
  useEffect(() => {
    setMailPolling(dialogOpen && dialog?.type === "account" ? 4000 : 8000);
  }, [dialogOpen, dialog?.type]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [account, setAccount] = useState<AccountDraft>(defaultAccount);
  const [automation, setAutomation] = useState<{
    id?: string;
    name: string;
    steps: Step[];
  }>({ name: "", steps: [] });
  const [projectLabels, setProjectLabels] = useState<Record<string, string>>(
    {},
  );
  const [note, setNote] = useState(""),
    [target, setTarget] = useState("");
  const [messageSubmitted, setMessageSubmitted] = useState(false);
  const [removeMessage, setRemoveMessage] = useState<Message | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [page, setPage] = useState(1);
  const messageTop = useRef<HTMLDivElement>(null);
  const scrollPage = useRef(false);
  function changePage(value: number) {
    scrollPage.current = true;
    setPage(value);
  }
  const [removeConfig, setRemoveConfig] = useState<{
    kind: "accounts" | "automations";
    id: string;
    name: string;
  } | null>(null);
  const interacting = useRef(false);
  const [submittingCheck, setSubmittingCheck] = useState(false);
  const checkActive = data?.manual_check?.status === "queued" ||
    data?.manual_check?.status === "running";

  const [absorbed, setAbsorbed] = useState<string[]>([]),
    [logOpen, setLogOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState("messages");
  const root = useRef<HTMLDivElement>(null);
  const [widePanels, setWidePanels] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidePanels(entry.contentRect.width >= 640),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setFieldErrors({});
    setError("");
    setNotice("");
  }, [dialog?.type]);
  const request = useRef(0),
    mutations = useRef(new Set<string>()),
    timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const fetchData = useCallback(
    async (quiet = false, signal?: AbortSignal) => {
      if (quiet && interacting.current) return;
      const version = ++request.current;
      if (!quiet) setLoading(true);
      try {
        const { data: result } = await api.get<Overview>(endpoint, {
          signal,
          params: {
            ...dates(period),
            account_id: selected || undefined,
            state: messageState,
            page,
          },
        });
        if (
          signal?.aborted ||
          version !== request.current ||
          (quiet && interacting.current)
        )
          return;
        setData(result);
        setPage(result.page);
        if (scrollPage.current || result.page !== page) {
          scrollPage.current = false;
          requestAnimationFrame(() =>
            messageTop.current?.scrollIntoView({ block: "start" }),
          );
        }
        setError("");
        setSelected((value) =>
          result.accounts.some((a) => a.id === value)
            ? value
            : (result.accounts[0]?.id ?? ""),
        );
      } catch (e) {
        if (!signal?.aborted && version === request.current)
          setError(errorMessage(e));
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [period, selected, messageState, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetchData(false, controller.signal);
    const generation = request;
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [fetchData]);
  const pollOverview = useCallback(
    (signal: AbortSignal) => fetchData(true, signal),
    [fetchData],
  );
  usePolling(pollOverview, checkActive ? 2000 : 8000, true, false);
  async function checkUpdates() {
    if (mutations.current.has("check-updates") || checkActive) return;
    mutations.current.add("check-updates");
    setSubmittingCheck(true);
    setError("");
    try {
      const response = await api.post<{ accepted: boolean; check: Overview["manual_check"] }>(
        `${endpoint}/check-updates`,
      );
      setData((current) => current ? { ...current, manual_check: response.data.check } : current);
      setNotice(response.data.accepted ? "检查更新已加入队列，将先收取邮件，再更新托管平台。" : "检查已排队或正在执行，请等待完成。");
      await fetchData(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      mutations.current.delete("check-updates");
      setSubmittingCheck(false);
    }
  }
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const viewedMessageId = dialog?.type === "message" ? dialog.message.id : null;
  const viewedHistoryPage =
    dialog?.type === "message" ? (dialog.message.jobs_page ?? 1) : 1;
  useEffect(() => {
    if (!dialogOpen || !viewedMessageId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function pollDetail() {
      try {
        const { data: message } = await api.get<Message>(
          `${endpoint}/messages/${viewedMessageId}`,
          {
            signal: controller.signal,
            params: { jobs_page: viewedHistoryPage },
          },
        );
        if (!controller.signal.aborted) {
          setMessageSubmitted(message.submitted || message.dismissed);
          setDialog((current) =>
            current?.type === "message" &&
            current.message.id === viewedMessageId
              ? { type: "message", message }
              : current,
          );
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(pollDetail, 4000);
      }
    }
    timer = setTimeout(pollDetail, 4000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dialogOpen, viewedMessageId, viewedHistoryPage]);
  async function perform(
    action: () => Promise<unknown>,
    message: string,
    close = false,
  ) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(message);
      if (close) setDialogOpen(false);
      await fetchData(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function openSchedule() {
    if (!data) return;
    const draft = structuredClone(data.schedule);
    if (!data.schedule_configured)
      draft.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setSchedule(draft);
    openDialog({ type: "schedule" });
  }
  function openAccount(a: Account) {
    setAccount({
      id: a.id,
      name: a.name,
      platform: a.platform,
      base_url: a.base_url,
      username: a.username,
      project_id: a.project_id ?? "",
      mail_folder_id: a.mail_folder_id ?? "",
      enabled: a.enabled,
      password: "",
    });
    openDialog({ type: "account", account: a });
  }
  function openAutomation(value?: Automation) {
    setAutomation({
      id: value?.id,
      name: value?.name ?? "",
      steps: structuredClone(value?.steps ?? [{ type: "read" }]),
    });
    openDialog({ type: "automation", automation: value });
  }
  async function openMessage(message: Message) {
    setMessageSubmitted(message.submitted || message.dismissed);
    setNote(message.note);
    setTarget(data?.automations.find((a) => a.kind !== "tapd")?.id ?? "");
    openDialog({ type: "message", message });
    await perform(
      async () => {
        const response = await api.post<Message>(
          `${endpoint}/messages/${message.id}/read`,
        );
        setDialog((current) =>
          current?.type === "message" && current.message.id === message.id
            ? { type: "message", message: response.data }
            : current,
        );
      },
      "已标记已读",
      false,
    );
  }
  async function submit(message: Message, automationId: string) {
    if (mutations.current.has(message.id)) return;
    mutations.current.add(message.id);
    setBusy(true);
    setError("");
    try {
      if (dialog?.type === "message")
        await api.put(`${endpoint}/messages/${message.id}/note`, { note });
      await api.post(`${endpoint}/messages/${message.id}/submit`, {
        automation_id: automationId,
      });
      setAbsorbed((ids) => [...ids, message.id]);
      if (dialog?.type === "message") setMessageSubmitted(true);
      setNotice("已成功入队，自动化将独立执行");
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        void fetchData(true);
        setAbsorbed((ids) => ids.filter((id) => id !== message.id));
      }, 420);
      timers.current.add(timer);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      mutations.current.delete(message.id);
      setBusy(false);
    }
  }
  async function reorder(kind: CardKind, id: string, targetId: string) {
    if (kind === "messages") return;
    if (!data || id === targetId) return;
    const before = data[kind];
    const next = [...before];
    const source = next.findIndex((item) => item.id === id),
      destination = next.findIndex((item) => item.id === targetId);
    if (source < 0 || destination < 0) return;
    next.splice(destination, 0, ...next.splice(source, 1));
    setData((current) => (current ? { ...current, [kind]: next } : current));
    interacting.current = true;
    setBusy(true);
    setError("");
    try {
      await api.put(`${endpoint}/order/${kind}`, {
        ids: next.map((item) => item.id),
      });
      setNotice(
        kind === "accounts"
          ? "平台顺序已保存，下一轮收取生效"
          : "自动化顺序已保存",
      );
    } catch (e) {
      setData((current) =>
        current ? { ...current, [kind]: before } : current,
      );
      setError(errorMessage(e));
    } finally {
      interacting.current = false;
      setBusy(false);
    }
  }
  const messages =
    data?.messages.filter((m) => m.account_id === selected) ?? [];
  const active = data?.accounts.find((a) => a.id === selected);
  const title =
    dialog?.type === "schedule"
      ? "定时收取设置"
      : dialog?.type === "account"
        ? "托管平台设置"
        : dialog?.type === "automation"
          ? "自动化步骤"
          : dialog?.type === "message"
            ? "消息详情与人工补充"
            : "执行记录";

  return (
    <WorkbenchDragCards
      onDraggingChange={(active) => {
        interacting.current = active;
      }}
      onMove={(kind, source, target) => void reorder(kind, source, target)}
      onSubmit={(messageId, automationId) => {
        const message = data?.messages.find((item) => item.id === messageId);
        if (
          data?.automations.find((item) => item.id === automationId)?.kind ===
          "tapd"
        )
          setNotice("TAPD 缺陷提交待开发，消息仍保留");
        else if (message) void submit(message, automationId);
      }}
    >
      <div
        ref={root}
        className={cn(
          "bg-background text-foreground flex min-h-full min-w-0 flex-col",
          styles.root,
        )}
      >
        <TopNav title="工作台" />
        <Container className="flex shrink-0 flex-wrap items-center gap-2 border-b py-2">
          <Tabs
            value={period}
            onValueChange={(value) => {
              setPage(1);
              setPeriod(String(value));
            }}
          >
            <TabsList aria-label="查看周期">
              <TabsTrigger value="today">今天</TabsTrigger>
              <TabsTrigger value="week">本周</TabsTrigger>
              <TabsTrigger value="month" title="最近 30 天">
                此月
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto min-w-0 flex-1" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新工作台"
            disabled={loading}
            onClick={() => void fetchData()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(loading && "animate-spin")}
            />
          </Button>
          <Button
            variant="outline"
            className="relative"
            aria-haspopup="dialog"
            onClick={() => {
              setLinkedMail(undefined);
              openMailbox();
            }}
          >
            <Mail data-icon="inline-start" />
            邮箱
            {!!mailData?.unread_total && (
              <Badge
                variant="destructive"
                className="bg-destructive absolute -top-2 -right-2 min-w-5 justify-center px-1 text-white"
                aria-label={`${mailData.unread_total} 封未读邮件`}
              >
                {mailData.unread_total}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            disabled={!data?.has_mailboxes || submittingCheck || checkActive}
            onClick={() => void checkUpdates()}
            title={!data?.has_mailboxes ? "请先登录邮箱" : "先收取邮件，再按托管顺序检查更新"}
          >
            {submittingCheck || checkActive ? <Loader2 className="animate-spin" /> : <Search />}
            {data?.manual_check?.status === "running" ? "正在检查" :
              data?.manual_check?.status === "queued" ? "检查已排队" : "检查更新"}
          </Button>
          <Button variant="outline" onClick={openSchedule} disabled={!data}>
            <Clock3 data-icon="inline-start" />
            定时任务
          </Button>
          <Button
            variant="outline"
            aria-haspopup="dialog"
            aria-expanded={logOpen}
            onClick={() => setLogOpen(true)}
          >
            <Terminal data-icon="inline-start" />
            AI 实时输出
          </Button>
        </Container>
        <Container className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 py-6">
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              {data?.schedule.enabled
                ? `每 ${data.schedule.interval_minutes} 分钟 · ${data.schedule.start}–${data.schedule.end} · ${data.schedule.timezone}`
                : "未启用定时收取，可点击检查更新立即收取"}
            </span>
            <span>
              下次收取：{dateTime(data?.next_run_at)} · 临时内容保留 30 天
            </span>
          </div>
          {error && !dialog && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
              <AlertAction>
                <Button variant="ghost" size="xs" onClick={() => setError("")}>
                  关闭
                </Button>
              </AlertAction>
            </Alert>
          )}
          {data?.manual_check?.status === "failed" && !dialog && (
            <Alert variant="destructive">
              <AlertDescription>{data.manual_check.error}；可点击“检查更新”重试。</AlertDescription>
            </Alert>
          )}
          {notice && !dialog && (
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground text-sm"
            >
              {notice}
            </p>
          )}
          <Tabs
            value={mobilePanel}
            onValueChange={setMobilePanel}
            className={styles.columns}
          >
            <section
              aria-label="正在托管"
              className={cn("space-y-2", styles.accounts)}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">正在托管</h2>
                <span className="text-muted-foreground text-xs">
                  {data?.accounts.length ?? 0}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                拖动排序 · 按顺序依次收取
              </p>
              {data?.accounts.some(
                (a) => !a.mail_folder_id || !a.project_id,
              ) && (
                <p className="text-muted-foreground text-xs">
                  现有托管平台需在设置中补充所属项目与邮件文件夹。
                </p>
              )}
              <CardList
                kind="accounts"
                ids={data?.accounts.map((a) => a.id) ?? []}
                className={styles.accountList}
              >
                {data?.accounts.map((a) => (
                  <DragCard
                    kind="accounts"
                    cardId={a.id}
                    key={a.id}
                    disabled={busy}
                    className={cn(
                      "relative flex-row items-center gap-2 overflow-visible p-2",
                      selected === a.id && "ring-primary bg-muted/50",
                    )}
                  >
                    {!!data.unread[a.id] && (
                      <Badge
                        variant="destructive"
                        className="bg-destructive absolute -top-1.5 -right-1.5 text-white"
                        aria-label={`${data.unread[a.id]} 条未读`}
                      >
                        {data.unread[a.id]}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 justify-start gap-2 p-0 text-left whitespace-normal hover:bg-transparent"
                      data-card-drag-surface
                      onClick={() => {
                        setPage(1);
                        setSelected(a.id);
                      }}
                      aria-pressed={selected === a.id}
                    >
                      <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded text-xs font-medium">
                        {a.platform === "jira" ? "J" : "YT"}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          title={a.name}
                          className="block truncate text-sm font-medium"
                        >
                          {a.name}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {platforms[a.platform]}
                          {!a.enabled && " · 已暂停"}
                        </span>
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`设置${a.name}`}
                      onClick={() => openAccount(a)}
                    >
                      <Settings />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`删除${a.name}`}
                      disabled={busy}
                      onClick={() => {
                        setRemoveError("");
                        setRemoveConfig({
                          kind: "accounts",
                          id: a.id,
                          name: a.name,
                        });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </DragCard>
                ))}
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => {
                    if (!data?.has_mailboxes) {
                      openMailbox();
                      return;
                    }
                    setAccount(defaultAccount);
                    openDialog({ type: "account" });
                  }}
                >
                  <Plus data-icon="inline-start" />
                  新增平台
                </Button>
              </CardList>
            </section>
            <div className={styles.mobileTabs}>
              <TabsList className="w-full" aria-label="工作台区域">
                <TabsTrigger className="flex-1" value="messages">
                  工作面板
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="automations">
                  自动化
                </TabsTrigger>
              </TabsList>
            </div>
            <WorkbenchPanel
              wide={widePanels}
              value="messages"
              aria-label="工作面板"
              className={cn("space-y-3", styles.messages)}
            >
              <div
                ref={messageTop}
                className="flex items-center justify-between gap-3"
              >
                <h2 className={cn("text-sm font-medium", styles.panelTitle)}>
                  工作面板
                </h2>
                <span className="text-muted-foreground text-xs">
                  {active?.name} {active && platforms[active.platform]}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                按信息时间从旧到新展示 · 以关联邮件时间保留 30 天
              </p>
              <Tabs
                value={messageState}
                onValueChange={(v) => {
                  setPage(1);
                  setMessageState(String(v));
                }}
              >
                <TabsList variant="line" aria-label="信息处理状态">
                  <TabsTrigger value="pending">待处理</TabsTrigger>
                  <TabsTrigger value="processed">已处理</TabsTrigger>
                  <TabsTrigger value="ignored">已忽略</TabsTrigger>
                </TabsList>
              </Tabs>
              {loading && !data ? (
                <div className="flex justify-center p-12">
                  <Loader2 className="animate-spin" />
                </div>
              ) : !messages.length ? (
                <Empty className="min-h-40 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Inbox />
                    </EmptyMedia>
                    <EmptyTitle>
                      {data?.accounts.length
                        ? "所选平台在此期间没有此状态的信息"
                        : "添加托管平台，开始汇聚客户信息"}
                    </EmptyTitle>
                    <EmptyDescription>
                      邮箱分类规则将推送移入关联文件夹后，自动收取网站详情。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <CardList
                  kind="messages"
                  ids={messages.map((m) => m.id)}
                  className="space-y-3"
                >
                  {messages.map((m) => (
                    <DragCard
                      kind="messages"
                      cardId={m.id}
                      key={m.id}
                      disabled={
                        busy ||
                        messageState !== "pending" ||
                        absorbed.includes(m.id)
                      }
                      aria-label={`查看消息 ${m.payload.key} ${m.payload.title}`}
                      onClick={() => {
                        if (!busy) void openMessage(m);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          event.target === event.currentTarget &&
                          !busy
                        ) {
                          event.preventDefault();
                          void openMessage(m);
                        }
                      }}
                      className={cn(
                        "cursor-default gap-3 p-4 transition-[transform,opacity] duration-300 motion-reduce:transition-none",
                        absorbed.includes(m.id) &&
                          "pointer-events-none translate-x-20 scale-0 opacity-0",
                      )}
                    >
                      <CardHeader className="gap-3 px-0">
                        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                          <span>
                            {m.payload.key} · {dateTime(m.received_at)}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`移除消息 ${m.payload.key}`}
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              setRemoveError("");
                              setRemoveMessage(m);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <CardTitle
                          role="heading"
                          aria-level={3}
                          className="text-sm break-words"
                        >
                          {m.payload.title}
                        </CardTitle>
                        <div className="flex gap-2 text-xs">
                          <Badge variant={m.is_read ? "outline" : "secondary"}>
                            {m.is_read ? "已读" : "未读"}
                          </Badge>
                          <Badge variant="outline">
                            {m.dismissed
                              ? "已忽略"
                              : m.submitted
                                ? "已处理"
                                : "待处理"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 px-0">
                        {m.resource_source?.kind === "email" && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto max-w-full justify-start p-0 text-xs whitespace-normal"
                            disabled={!m.resource_source.mail_id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setLinkedMail(
                                m.resource_source?.mail_id ?? undefined,
                              );
                              openMailbox();
                            }}
                          >
                            最新来源：邮件 ·{" "}
                            {dateTime(m.resource_source.timestamp)}
                            {!m.resource_source.mail_id &&
                              "（已过期或移出文件夹）"}
                          </Button>
                        )}

                        <p className="text-muted-foreground line-clamp-4 text-sm break-words whitespace-pre-wrap">
                          {m.payload.body}
                        </p>
                        {m.note && (
                          <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-wrap">
                            补充：{m.note}
                          </p>
                        )}
                      </CardContent>
                    </DragCard>
                  ))}
                </CardList>
              )}
              {data && data.total_messages > 0 && (
                <nav
                  aria-label="工作面板分页"
                  className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 pb-20 sm:pb-3"
                >
                  <span className="text-muted-foreground text-xs">
                    共 {data.total_messages} 条 · 第 {data.page} /{" "}
                    {Math.max(
                      1,
                      Math.ceil(data.total_messages / data.page_size),
                    )}{" "}
                    页
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loading || busy || data.page <= 1}
                      onClick={() => changePage(data.page - 1)}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        loading ||
                        busy ||
                        data.page * data.page_size >= data.total_messages
                      }
                      onClick={() => changePage(data.page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </nav>
              )}
            </WorkbenchPanel>
            <WorkbenchPanel
              wide={widePanels}
              value="automations"
              aria-label="自动化"
              className={cn("space-y-3", styles.automations)}
            >
              <div className="flex items-center justify-between">
                <h2 className={cn("text-sm font-medium", styles.panelTitle)}>
                  自动化
                </h2>
                <span className="text-muted-foreground text-xs">顺序轮询</span>
              </div>
              <p className="text-muted-foreground text-xs">
                独立执行 · 同一卡片内先进先出
              </p>
              <CardList
                kind="automations"
                ids={data?.automations.map((a) => a.id) ?? []}
                className="space-y-3"
              >
                {data?.automations.map((a) => {
                  const counts = data.counts[a.id] ?? {};
                  return (
                    <DragCard
                      kind="automations"
                      cardId={a.id}
                      key={a.id}
                      disabled={busy}
                      className={cn(
                        "relative gap-3 p-4 transition-colors",
                        a.kind === "tapd" && "bg-muted/30",
                      )}
                    >
                      <CardHeader className="flex items-center gap-2 px-0">
                        <CardTitle
                          role="heading"
                          aria-level={3}
                          className="min-w-0 flex-1 text-sm break-words"
                        >
                          {a.name}
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`设置${a.name}`}
                          onClick={() => void openAutomation(a)}
                        >
                          <Settings2 />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`删除${a.name}`}
                          disabled={busy}
                          onClick={() => {
                            setRemoveError("");
                            setRemoveConfig({
                              kind: "automations",
                              id: a.id,
                              name: a.name,
                            });
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3 px-0">
                        {a.kind === "tapd" ? (
                          <>
                            <p className="text-muted-foreground text-xs">
                              仅支持缺陷 · 提交功能待开发
                            </p>
                            <span className="text-muted-foreground text-xs">
                              暂不接收消息
                            </span>
                          </>
                        ) : (
                          <>
                            <p className="text-xs">
                              {counts.running ? "● 正在执行" : "等待任务"}{" "}
                              {counts.running ?? 0} · 排队 {counts.queued ?? 0}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {a.steps.length} 个步骤
                              {a.steps.some((s) => s.type === "ticket") &&
                                " · 沿用信息所属项目"}
                            </p>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto self-start p-0 text-xs"
                              onClick={() =>
                                openDialog({ type: "history", automation: a })
                              }
                            >
                              已完成 {counts.completed ?? 0} · 失败{" "}
                              {counts.failed ?? 0} · 执行记录
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </DragCard>
                  );
                })}
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => void openAutomation()}
                >
                  <Plus data-icon="inline-start" />
                  新建自动化
                </Button>
              </CardList>
            </WorkbenchPanel>
          </Tabs>
          <WorkbenchDebugConsole
            open={logOpen}
            onClose={() => setLogOpen(false)}
          />
          {mailMounted && (
            <MailWindow
              open={mailOpen}
              mailId={linkedMail}
              onClose={() => setMailOpen(false)}
              onUnreadChange={(unread_total) =>
                setMailData((current) =>
                  current ? { ...current, unread_total } : current,
                )
              }
              onChanged={() => {
                reloadMail();
                void fetchData(true);
              }}
            />
          )}
        </Container>
        {removeConfig && (
          <ConfirmDialog
            open
            title={`删除${removeConfig.kind === "accounts" ? "托管平台" : "自动化"}？`}
            description={`删除“${removeConfig.name}”后停止后续使用。已入队任务继续执行，已有处理记录按缓存期限保留，已创建的 Ticket 不受影响。`}
            destructive
            busy={removing}
            error={removeError}
            confirmLabel="确认删除"
            onCancel={() => setRemoveConfig(null)}
            onConfirm={async () => {
              if (removing) return;
              setRemoving(true);
              setRemoveError("");
              try {
                await api.delete(
                  `${endpoint}/${removeConfig.kind}/${removeConfig.id}`,
                );
                setRemoveConfig(null);
                setPage(1);
                setNotice("已删除");
                await fetchData(true);
              } catch (e) {
                setRemoveError(errorMessage(e));
              } finally {
                setRemoving(false);
              }
            }}
          />
        )}
        {removeMessage && (
          <ConfirmDialog
            open
            title="移除此消息？"
            description={`将“${removeMessage.payload.title}”移到已忽略。收到更新仍保留在已忽略，并标记未读；30天后随缓存清理。`}
            destructive
            busy={removing}
            error={removeError}
            confirmLabel="确认移除"
            onCancel={() => setRemoveMessage(null)}
            onConfirm={async () => {
              if (removing) return;
              setRemoving(true);
              setRemoveError("");
              try {
                await api.post(
                  `${endpoint}/messages/${removeMessage.id}/dismiss`,
                );
                setData((current) =>
                  current
                    ? {
                        ...current,
                        messages: current.messages.filter(
                          (item) => item.id !== removeMessage.id,
                        ),
                      }
                    : current,
                );
                setRemoveMessage(null);
                setNotice("消息已移除");
                await fetchData(true);
              } catch (e) {
                setRemoveError(errorMessage(e));
              } finally {
                setRemoving(false);
              }
            }}
          />
        )}
        <Dialog
          open={dialogOpen}
          disablePointerDismissal
          onOpenChange={(open, details) => {
            if (!open && (details.reason !== "close-press" || busy)) {
              details.cancel();
              return;
            }
            if (!open) setDialogOpen(false);
          }}
          onOpenChangeComplete={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
            <DialogHeader className="shrink-0 pr-6">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {dialog?.type === "schedule"
                  ? "只控制平台收取时间，自动化执行不受此计划限制。"
                  : dialog?.type === "automation"
                    ? "自由组合操作，按步骤顺序执行。已入队任务使用提交时的步骤快照。"
                    : dialog?.type === "history"
                      ? `自动化：${dialog.automation.name}。失败任务可重试并重新排队。`
                      : "所有设置和数据仅对当前账户可见。"}
              </DialogDescription>
            </DialogHeader>
            {dialog?.type !== "history" && (
              <ScrollArea className="-mx-4 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [&>[data-slot=scroll-area-viewport]]:min-h-0">
                <div className="space-y-4 px-4 py-1">
                  {error && <FieldError role="alert">{error}</FieldError>}
                  {notice && (
                    <p role="status" className="text-muted-foreground text-xs">
                      {notice}
                    </p>
                  )}
                  {dialog?.type === "schedule" && schedule && (
                    <FieldGroup>
                      <Field orientation="horizontal" className="w-auto">
                        <Checkbox
                          id="workbench-field-2"
                          checked={schedule.enabled}
                          onCheckedChange={(enabled) =>
                            setSchedule({ ...schedule, enabled: !!enabled })
                          }
                        />
                        <FieldLabel htmlFor="workbench-field-2">
                          启用定时收取
                        </FieldLabel>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-3">
                          收取间隔
                        </FieldLabel>
                        <NativeSelect
                          id="workbench-field-3"
                          value={schedule.interval_minutes}
                          onChange={(e) =>
                            setSchedule({
                              ...schedule,
                              interval_minutes: Number(e.target.value),
                            })
                          }
                        >
                          {[15, 30, 60, 120, 180, 240].map((n) => (
                            <NativeSelectOption key={n} value={n}>
                              {n < 60 ? `${n} 分钟` : `${n / 60} 小时`}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <div>
                        <p className="mb-2">工作日</p>
                        <div className="flex flex-wrap gap-4">
                          {["一", "二", "三", "四", "五", "六", "日"].map(
                            (day, i) => (
                              <Field
                                key={day}
                                orientation="horizontal"
                                className="w-auto"
                              >
                                <Checkbox
                                  id={`workbench-field-4-${i}`}
                                  checked={schedule.weekdays.includes(i)}
                                  onCheckedChange={(checked) =>
                                    setSchedule({
                                      ...schedule,
                                      weekdays: checked
                                        ? [...schedule.weekdays, i]
                                        : schedule.weekdays.filter(
                                            (d) => d !== i,
                                          ),
                                    })
                                  }
                                />
                                <FieldLabel htmlFor={`workbench-field-4-${i}`}>
                                  周{day}
                                </FieldLabel>
                              </Field>
                            ),
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field>
                          <FieldLabel htmlFor="workbench-field-5">
                            开始时间
                          </FieldLabel>
                          <Input
                            id="workbench-field-5"
                            aria-invalid={!!fieldErrors["workbench-field-5"]}
                            aria-describedby={
                              fieldErrors["workbench-field-5"]
                                ? "workbench-field-5-error"
                                : undefined
                            }
                            type="time"
                            value={schedule.start}
                            onChange={(e) =>
                              setSchedule({
                                ...schedule,
                                start: e.target.value,
                              })
                            }
                          />
                          {fieldErrors["workbench-field-5"] && (
                            <FieldError id="workbench-field-5-error">
                              {fieldErrors["workbench-field-5"]}
                            </FieldError>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="workbench-field-6">
                            结束时间
                          </FieldLabel>
                          <Input
                            id="workbench-field-6"
                            aria-invalid={!!fieldErrors["workbench-field-6"]}
                            aria-describedby={
                              fieldErrors["workbench-field-6"]
                                ? "workbench-field-6-error"
                                : undefined
                            }
                            type="time"
                            value={schedule.end}
                            onChange={(e) =>
                              setSchedule({ ...schedule, end: e.target.value })
                            }
                          />
                          {fieldErrors["workbench-field-6"] && (
                            <FieldError id="workbench-field-6-error">
                              {fieldErrors["workbench-field-6"]}
                            </FieldError>
                          )}
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-7">
                          时区
                        </FieldLabel>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1 [&>button]:overflow-hidden [&>button]:text-ellipsis [&>button]:whitespace-nowrap">
                            <TimezoneSelect
                              id="workbench-field-7"
                              value={schedule.timezone}
                              onChange={(timezone) =>
                                setSchedule({ ...schedule, timezone })
                              }
                              invalid={!!fieldErrors["workbench-field-7"]}
                              describedBy={
                                fieldErrors["workbench-field-7"]
                                  ? "workbench-field-7-error"
                                  : undefined
                              }
                            />
                          </div>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setSchedule({
                                ...schedule,
                                timezone:
                                  Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone,
                              })
                            }
                          >
                            使用浏览器时区
                          </Button>
                        </div>
                        {fieldErrors["workbench-field-7"] && (
                          <FieldError id="workbench-field-7-error">
                            {fieldErrors["workbench-field-7"]}
                          </FieldError>
                        )}
                      </Field>
                      <p className="text-muted-foreground text-xs">
                        从所设开始时间按间隔触发；只判断每个平台开始时是否在工作时间内，已开始则执行到结束。出差后请手动更新时区或时间。
                      </p>
                    </FieldGroup>
                  )}
                  {dialog?.type === "account" && (
                    <div className="space-y-5">
                      {dialog.account?.error && (
                        <p role="alert" className="text-destructive text-sm">
                          {dialog.account.error}
                        </p>
                      )}
                      <Field>
                        <FieldLabel htmlFor="workbench-field-8">
                          客户 / 账户名称
                        </FieldLabel>
                        <Input
                          id="workbench-field-8"
                          aria-invalid={!!fieldErrors["workbench-field-8"]}
                          aria-describedby={
                            fieldErrors["workbench-field-8"]
                              ? "workbench-field-8-error"
                              : undefined
                          }
                          value={account.name}
                          onChange={(e) =>
                            setAccount({ ...account, name: e.target.value })
                          }
                        />
                        {fieldErrors["workbench-field-8"] && (
                          <FieldError id="workbench-field-8-error">
                            {fieldErrors["workbench-field-8"]}
                          </FieldError>
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-9">
                          平台
                        </FieldLabel>
                        <NativeSelect
                          id="workbench-field-9"
                          value={account.platform}
                          onChange={(e) =>
                            setAccount({
                              ...account,
                              platform: e.target.value as Account["platform"],
                            })
                          }
                        >
                          {Object.entries(platforms)

                            .map(([k, v]) => (
                              <NativeSelectOption key={k} value={k}>
                                {v}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-10">
                          HTTPS 站点根地址
                        </FieldLabel>
                        <Input
                          id="workbench-field-10"
                          aria-invalid={!!fieldErrors["workbench-field-10"]}
                          aria-describedby={
                            fieldErrors["workbench-field-10"]
                              ? "workbench-field-10-error"
                              : undefined
                          }
                          value={account.base_url}
                          placeholder="https://jira.example.com"
                          onChange={(e) =>
                            setAccount({ ...account, base_url: e.target.value })
                          }
                        />
                        {fieldErrors["workbench-field-10"] && (
                          <FieldError id="workbench-field-10-error">
                            {fieldErrors["workbench-field-10"]}
                          </FieldError>
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-11">
                          用户名
                        </FieldLabel>
                        <Input
                          id="workbench-field-11"
                          aria-invalid={!!fieldErrors["workbench-field-11"]}
                          aria-describedby={
                            fieldErrors["workbench-field-11"]
                              ? "workbench-field-11-error"
                              : undefined
                          }
                          autoComplete="off"
                          value={account.username}
                          onChange={(e) =>
                            setAccount({ ...account, username: e.target.value })
                          }
                        />
                        {fieldErrors["workbench-field-11"] && (
                          <FieldError id="workbench-field-11-error">
                            {fieldErrors["workbench-field-11"]}
                          </FieldError>
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-12">
                          {account.platform === "youtrack"
                            ? "永久访问令牌"
                            : "密码 / 授权码"}
                        </FieldLabel>
                        <Input
                          id="workbench-field-12"
                          aria-invalid={!!fieldErrors["workbench-field-12"]}
                          aria-describedby={
                            fieldErrors["workbench-field-12"]
                              ? "workbench-field-12-error"
                              : undefined
                          }
                          type="password"
                          autoComplete="new-password"
                          value={account.password}
                          placeholder={
                            account.id ? "留空保持原凭据" : "请输入授权凭据"
                          }
                          onChange={(e) =>
                            setAccount({ ...account, password: e.target.value })
                          }
                        />
                        {fieldErrors["workbench-field-12"] && (
                          <FieldError id="workbench-field-12-error">
                            {fieldErrors["workbench-field-12"]}
                          </FieldError>
                        )}
                      </Field>
                      <Field>
                        <FieldLabel>所属项目</FieldLabel>
                        <SearchSelect
                          label="选择所属项目"
                          value={account.project_id}
                          selectedLabel={
                            projectLabels[account.project_id] ??
                            account.project_id
                          }
                          url="/api/v1/catalog/projects"
                          kind="catalog"
                          onChange={(option) => {
                            setAccount({
                              ...account,
                              project_id: option.value,
                            });
                            setProjectLabels((labels) => ({
                              ...labels,
                              [option.value]: option.label,
                            }));
                          }}
                        />
                      </Field>
                      <CatalogCombobox
                        id="hosting-mail-folder"
                        label="链接邮件文件夹"
                        value={
                          account.mail_folder_id ? [account.mail_folder_id] : []
                        }
                        options={(mailData?.folders ?? [])
                          .filter((f) => f.selectable)
                          .map((f) => ({
                            value: f.id,
                            label: `${mailData?.mailboxes.find((b) => b.id === f.mailbox_id)?.address} / ${f.path}`,
                          }))}
                        onChange={(values) =>
                          setAccount({
                            ...account,
                            mail_folder_id: values[0] ?? "",
                          })
                        }
                      />
                      <p className="text-muted-foreground text-xs">
                        仅监控此文件夹最近30天的邮件推送，通过邮件内的同站点链接收取问题详情。
                      </p>
                      <Field orientation="horizontal" className="w-auto">
                        <Checkbox
                          id="workbench-field-14"
                          checked={account.enabled}
                          onCheckedChange={(enabled) =>
                            setAccount({ ...account, enabled: !!enabled })
                          }
                        />
                        <FieldLabel htmlFor="workbench-field-14">
                          启用此平台
                        </FieldLabel>
                      </Field>
                      <p className="text-muted-foreground text-xs">
                        平台主机须由管理员加入允许列表。凭据加密保存，收取只读取来源数据。
                      </p>
                    </div>
                  )}
                  {dialog?.type === "automation" &&
                    (dialog.automation?.kind === "tapd" ? (
                      <p className="text-muted-foreground py-8">
                        导入类型：缺陷。提交与配置功能将在后续开发，当前暂不接收消息。
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <Field>
                          <FieldLabel htmlFor="workbench-field-15">
                            自动化名称
                          </FieldLabel>
                          <Input
                            id="workbench-field-15"
                            aria-invalid={!!fieldErrors["workbench-field-15"]}
                            aria-describedby={
                              fieldErrors["workbench-field-15"]
                                ? "workbench-field-15-error"
                                : undefined
                            }
                            value={automation.name}
                            onChange={(e) =>
                              setAutomation({
                                ...automation,
                                name: e.target.value,
                              })
                            }
                          />
                          {fieldErrors["workbench-field-15"] && (
                            <FieldError id="workbench-field-15-error">
                              {fieldErrors["workbench-field-15"]}
                            </FieldError>
                          )}
                        </Field>
                        {automation.steps.map((step, i) => (
                          <Card key={i} className="gap-3 p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-xs">
                                {i + 1}
                              </span>
                              <NativeSelect
                                aria-label={`第${i + 1}步操作`}
                                className="min-w-0 flex-1"
                                value={step.type}
                                onChange={(e) => {
                                  const steps = [...automation.steps];
                                  steps[i] = {
                                    ...step,
                                    type: e.target.value as Step["type"],
                                  };
                                  setAutomation({ ...automation, steps });
                                }}
                              >
                                {Object.entries(stepLabels).map(([k, v]) => (
                                  <NativeSelectOption key={k} value={k}>
                                    {v}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="步骤上移"
                                disabled={i === 0}
                                onClick={() => {
                                  const steps = [...automation.steps];
                                  [steps[i - 1], steps[i]] = [
                                    steps[i],
                                    steps[i - 1],
                                  ];
                                  setAutomation({ ...automation, steps });
                                }}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="步骤下移"
                                disabled={i === automation.steps.length - 1}
                                onClick={() => {
                                  const steps = [...automation.steps];
                                  [steps[i + 1], steps[i]] = [
                                    steps[i],
                                    steps[i + 1],
                                  ];
                                  setAutomation({ ...automation, steps });
                                }}
                              >
                                <ArrowDown />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="删除步骤"
                                onClick={() =>
                                  setAutomation({
                                    ...automation,
                                    steps: automation.steps.filter(
                                      (_, n) => n !== i,
                                    ),
                                  })
                                }
                              >
                                <Trash2 />
                              </Button>
                            </div>
                            {step.type === "ai" && (
                              <Textarea
                                aria-label="AI处理要求"
                                value={step.instruction ?? ""}
                                placeholder="填写整理要求，保留来源事实"
                                onChange={(e) => {
                                  const steps = [...automation.steps];
                                  steps[i] = {
                                    ...step,
                                    instruction: e.target.value,
                                  };
                                  setAutomation({ ...automation, steps });
                                }}
                              />
                            )}
                            {step.type === "ticket" && (
                              <p className="text-muted-foreground text-xs">
                                目标项目自动沿用此信息绑定的托管项目，无需单独选择。
                              </p>
                            )}
                            {(step.type === "map" ||
                              step.type === "ticket") && (
                              <Field>
                                <FieldLabel htmlFor={`workbench-field-17-${i}`}>
                                  优先级
                                </FieldLabel>
                                <NativeSelect
                                  id={`workbench-field-17-${i}`}
                                  value={step.priority ?? "major"}
                                  onChange={(e) => {
                                    const steps = [...automation.steps];
                                    steps[i] = {
                                      ...step,
                                      priority: e.target.value,
                                    };
                                    setAutomation({ ...automation, steps });
                                  }}
                                >
                                  <NativeSelectOption value="critical">
                                    严重
                                  </NativeSelectOption>
                                  <NativeSelectOption value="major">
                                    一般
                                  </NativeSelectOption>
                                  <NativeSelectOption value="trivial">
                                    轻微
                                  </NativeSelectOption>
                                </NativeSelect>
                              </Field>
                            )}
                          </Card>
                        ))}
                        <Button
                          variant="outline"
                          disabled={automation.steps.length >= 30}
                          onClick={() =>
                            setAutomation({
                              ...automation,
                              steps: [...automation.steps, { type: "read" }],
                            })
                          }
                        >
                          <Plus data-icon="inline-start" />
                          添加操作
                        </Button>
                      </div>
                    ))}
                  {dialog?.type === "message" && (
                    <div className="space-y-3">
                      {!!dialog.message.mails?.length && (
                        <div className="space-y-1">
                          <p className="text-muted-foreground text-xs">
                            关联邮件 · 点击原文才同步邮箱已读
                          </p>
                          {dialog.message.mails.map((m) => (
                            <Button
                              key={m.id}
                              variant="link"
                              className="h-auto max-w-full justify-start text-left whitespace-normal"
                              onClick={() => {
                                setDialogOpen(false);
                                setLinkedMail(m.id);
                                openMailbox();
                              }}
                            >
                              {dialog.message.resource_source?.mail_id ===
                                m.id && "最新来源 · "}
                              {m.subject} · {dateTime(m.received_at)}
                            </Button>
                          ))}
                        </div>
                      )}
                      {dialog.message.dismissed && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              () =>
                                api.post(
                                  `${endpoint}/messages/${dialog.message.id}/restore`,
                                ),
                              "已恢复到待处理",
                              true,
                            )
                          }
                        >
                          恢复到待处理
                        </Button>
                      )}
                      {!!dialog.message.jobs?.length && (
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium">
                            自动化处理记录
                          </h4>
                          {dialog.message.jobs.map((job) => (
                            <div
                              key={job.id}
                              className="space-y-2 rounded-md border p-3 text-xs"
                            >
                              <p>
                                {
                                  {
                                    queued: "排队中",
                                    running: "正在执行",
                                    completed: "已完成",
                                    failed: "失败",
                                  }[job.status]
                                }{" "}
                                · {job.step_index}/{job.steps.length} 步 ·{" "}
                                {dateTime(job.queued_at)}
                              </p>
                              {job.steps.map((step, i) => (
                                <p key={i}>
                                  {i + 1}. {stepLabels[step.type]} ·{" "}
                                  {i < job.step_index
                                    ? "完成"
                                    : i === job.step_index &&
                                        job.status === "running"
                                      ? "执行中"
                                      : "未完成"}
                                </p>
                              ))}
                              {job.logs.map((log, i) => (
                                <p
                                  className="text-muted-foreground whitespace-pre-wrap"
                                  key={i}
                                >
                                  {dateTime(log.at)} {log.message}
                                </p>
                              ))}
                              {job.error && (
                                <p className="text-destructive">{job.error}</p>
                              )}
                              {job.snapshot.summary && (
                                <p className="whitespace-pre-wrap">
                                  {job.snapshot.summary}
                                </p>
                              )}
                              {job.ticket_id && (
                                <a className="underline" href="/ticket">
                                  前往 Ticket
                                </a>
                              )}
                              {job.status === "failed" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void perform(
                                      () =>
                                        api.post(
                                          `${endpoint}/jobs/${job.id}/retry`,
                                        ),
                                      "已重新入队",
                                      true,
                                    )
                                  }
                                >
                                  重试
                                </Button>
                              )}
                            </div>
                          ))}
                          {(dialog.message.jobs_total ?? 0) > 10 && (
                            <nav
                              aria-label="信息执行记录分页"
                              className="flex flex-wrap items-center justify-between gap-2"
                            >
                              <span className="text-muted-foreground text-xs">
                                共 {dialog.message.jobs_total} 次 · 第{" "}
                                {dialog.message.jobs_page ?? 1} 页
                              </span>
                              <div className="flex gap-2">
                                {[-1, 1].map((offset) => (
                                  <Button
                                    key={offset}
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                      busy ||
                                      (offset < 0
                                        ? (dialog.message.jobs_page ?? 1) <= 1
                                        : (dialog.message.jobs_page ?? 1) *
                                            10 >=
                                          (dialog.message.jobs_total ?? 0))
                                    }
                                    onClick={() => {
                                      const id = dialog.message.id;
                                      const page =
                                        (dialog.message.jobs_page ?? 1) +
                                        offset;
                                      void perform(async () => {
                                        const { data: message } =
                                          await api.get<Message>(
                                            `${endpoint}/messages/${id}`,
                                            { params: { jobs_page: page } },
                                          );
                                        setDialog((current) =>
                                          current?.type === "message" &&
                                          current.message.id === id
                                            ? { ...current, message }
                                            : current,
                                        );
                                      }, "执行记录已更新");
                                    }}
                                  >
                                    {offset < 0 ? "上一页" : "下一页"}
                                  </Button>
                                ))}
                              </div>
                            </nav>
                          )}
                        </div>
                      )}
                      <h3 className="font-medium">
                        {dialog.message.payload.title}
                      </h3>
                      <p className="text-sm break-words whitespace-pre-wrap">
                        {dialog.message.payload.body}
                      </p>
                      {safeUrl(dialog.message.payload.url) && (
                        <a
                          href={safeUrl(dialog.message.payload.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm underline"
                        >
                          查看来源
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                      {dialog.message.payload.attachments?.map((a, i) => (
                        <p key={i} className="text-xs">
                          附件：
                          {safeUrl(a.url) ? (
                            <a
                              className="underline"
                              href={safeUrl(a.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {a.name}
                            </a>
                          ) : (
                            a.name
                          )}
                        </p>
                      ))}
                      <Field>
                        <FieldLabel htmlFor="workbench-field-18">
                          人工补充
                        </FieldLabel>
                        <Textarea
                          id="workbench-field-18"
                          rows={4}
                          disabled={
                            dialog.message.submitted || dialog.message.dismissed
                          }
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="workbench-field-19">
                          提交至自动化
                        </FieldLabel>
                        <NativeSelect
                          id="workbench-field-19"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          {data?.automations
                            .filter((a) => a.kind !== "tapd")
                            .map((a) => (
                              <NativeSelectOption key={a.id} value={a.id}>
                                {a.name}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                      </Field>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
            {dialog?.type === "history" && (
              <HistoryRecords
                key={dialog.automation.id}
                automationId={dialog.automation.id}
                open={dialogOpen}
                onRetry={() => void fetchData(true)}
              />
            )}
            {dialog &&
              dialog.type !== "history" &&
              !(
                dialog.type === "automation" &&
                dialog.automation?.kind === "tapd"
              ) && (
                <DialogFooter className="shrink-0">
                  {dialog.type === "message" && (
                    <Button
                      disabled={
                        busy ||
                        !target ||
                        messageSubmitted ||
                        dialog.message.submitted ||
                        dialog.message.dismissed
                      }
                      onClick={() => void submit(dialog.message, target)}
                    >
                      {messageSubmitted ? "已提交至自动化" : "提交并移入队列"}
                    </Button>
                  )}
                  <Button
                    disabled={
                      busy ||
                      (dialog?.type === "message" &&
                        (messageSubmitted ||
                          dialog.message.submitted ||
                          dialog.message.dismissed))
                    }
                    onClick={() => {
                      const errors: Record<string, string> = {};
                      if (dialog?.type === "account") {
                        if (!account.name.trim())
                          errors["workbench-field-8"] = "请输入客户 / 账户名称";
                        if (!account.base_url.trim())
                          errors["workbench-field-10"] = "请输入平台地址";
                        if (!account.username.trim())
                          errors["workbench-field-11"] = "请输入用户名";
                        if (!account.id && !account.password.trim())
                          errors["workbench-field-12"] = "请输入授权凭据";
                      }
                      if (
                        dialog?.type === "automation" &&
                        !automation.name.trim()
                      )
                        errors["workbench-field-15"] = "请输入自动化名称";
                      if (dialog?.type === "schedule" && schedule) {
                        if (!schedule.start)
                          errors["workbench-field-5"] = "请选择开始时间";
                        if (!schedule.end || schedule.end <= schedule.start)
                          errors["workbench-field-6"] =
                            "结束时间必须晚于开始时间";
                        try {
                          new Intl.DateTimeFormat(undefined, {
                            timeZone: schedule.timezone,
                          });
                        } catch {
                          errors["workbench-field-7"] =
                            "请输入有效的 IANA 时区";
                        }
                      }
                      setFieldErrors(errors);
                      if (Object.keys(errors).length) return;
                      if (dialog?.type === "schedule" && schedule)
                        void perform(
                          () => api.put(`${endpoint}/schedule`, schedule),
                          "收取计划已保存",
                        );
                      if (dialog?.type === "account") {
                        const { id, password, ...values } = account;
                        void perform(
                          () =>
                            id
                              ? api.put(`${endpoint}/accounts/${id}`, {
                                  ...values,
                                  password: password || null,
                                })
                              : api
                                  .post(`${endpoint}/accounts`, {
                                    ...values,
                                    password,
                                  })
                                  .then(({ data: saved }) => {
                                    setAccount((current) => ({
                                      ...current,
                                      id: saved.id,
                                      password: "",
                                    }));
                                  }),
                          "托管平台已保存",
                        );
                      }
                      if (dialog?.type === "automation") {
                        const { id, ...values } = automation;
                        void perform(
                          () =>
                            id
                              ? api.put(`${endpoint}/automations/${id}`, values)
                              : api
                                  .post(`${endpoint}/automations`, values)
                                  .then(({ data: saved }) =>
                                    setAutomation((current) => ({
                                      ...current,
                                      id: saved.id,
                                    })),
                                  ),
                          "自动化已保存",
                        );
                      }
                      if (dialog?.type === "message")
                        void perform(
                          () =>
                            api.put(
                              `${endpoint}/messages/${dialog.message.id}/note`,
                              { note },
                            ),
                          "补充内容已保存",
                        );
                    }}
                  >
                    {busy && <Loader2 className="animate-spin" />}保存
                    {dialog?.type === "message" ? "补充" : "设置"}
                  </Button>
                </DialogFooter>
              )}
          </DialogContent>
        </Dialog>
      </div>
    </WorkbenchDragCards>
  );
}
