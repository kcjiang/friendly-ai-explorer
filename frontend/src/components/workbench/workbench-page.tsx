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
import { useLocale } from "next-intl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/catalog/catalog-ui";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/base/field";
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
import { usePolling } from "@/hooks/use-polling";
import { getBrowserUiLocale } from "@/i18n/browser";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";
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
import { AccountForm } from "./account-form";
import { ScheduleForm } from "./schedule-form";
import {
  type AccountDraft,
  defaultAccount,
  platforms,
  stepLabels,
} from "./settings";
import styles from "./workbench.module.css";

const MailWindow = dynamic(
  () =>
    import("@/components/workbench/mail-window").then(
      (module) => module.MailWindow,
    ),
  { ssr: false },
);
const endpoint = "/api/v1/workbench";
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
    ? new Date(value).toLocaleString(getBrowserUiLocale(), {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not run yet";
}
function safeUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : undefined;
}

export default function WorkbenchPage() {
  const locale = useLocale();

  const t = useUiTranslations();
  const localizedStepLabels = translateLabels(stepLabels, t);

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
  const checkActive =
    data?.manual_check?.status === "queued" ||
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
      const response = await api.post<{
        accepted: boolean;
        check: Overview["manual_check"];
      }>(`${endpoint}/check-updates`);
      setData((current) =>
        current ? { ...current, manual_check: response.data.check } : current,
      );
      setNotice(
        response.data.accepted
          ? t("ui.updateCheckQueuedMailWillBeCollectedBeforeCheckingPlatforms")
          : t("ui.checkQueuedOrRunningWaitForCompletion"),
      );
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
      t("ui.markedAsRead"),
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
      setNotice(t("ui.queuedAutomationWillRunIndependently"));
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
          ? t("ui.platformOrderSavedForTheNextCollection")
          : t("ui.automationOrderSaved"),
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
      ? t("ui.scheduledCollectionSettings")
      : dialog?.type === "account"
        ? t("ui.platformSettings")
        : dialog?.type === "automation"
          ? t("ui.automationSteps")
          : dialog?.type === "message"
            ? t("ui.messageDetailsAndNotes")
            : t("ui.executionHistory");

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
          setNotice(t("ui.tapdSubmissionIsNotAvailableYetMessagesAreRetained"));
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
        <TopNav title={t("ui.workbench")} />
        <Container className="flex shrink-0 flex-wrap items-center gap-2 border-b py-2">
          <Tabs
            value={period}
            onValueChange={(value) => {
              setPage(1);
              setPeriod(String(value));
            }}
          >
            <TabsList aria-label={t("ui.timeRange")}>
              <TabsTrigger value="today">{t("ui.today")}</TabsTrigger>
              <TabsTrigger value="week">{t("ui.thisWeek")}</TabsTrigger>
              <TabsTrigger value="month" title={t("ui.last30Days")}>
                {t("ui.thisMonth")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto min-w-0 flex-1" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("ui.refreshWorkbench")}
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
            {t("ui.email")}
            {!!mailData?.unread_total && (
              <Badge
                variant="destructive"
                className="bg-destructive absolute -top-2 -right-2 min-w-5 justify-center px-1 text-white"
                aria-label={t("dynamic.other", { p0: mailData.unread_total })}
              >
                {mailData.unread_total}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            disabled={!data?.has_mailboxes || submittingCheck || checkActive}
            onClick={() => void checkUpdates()}
            title={
              !data?.has_mailboxes
                ? t("ui.signInToAMailboxFirst")
                : t("ui.collectMailThenCheckPlatformsInOrder")
            }
          >
            {submittingCheck || checkActive ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Search />
            )}
            {data?.manual_check?.status === "running"
              ? t("ui.checking")
              : data?.manual_check?.status === "queued"
                ? t("ui.checkQueued")
                : t("ui.checkUpdates")}
          </Button>
          <Button variant="outline" onClick={openSchedule} disabled={!data}>
            <Clock3 data-icon="inline-start" />
            {t("ui.scheduledTasks")}
          </Button>
          <Button
            variant="outline"
            aria-haspopup="dialog"
            aria-expanded={logOpen}
            onClick={() => setLogOpen(true)}
          >
            <Terminal data-icon="inline-start" />
            {t("ui.liveAiOutput")}
          </Button>
        </Container>
        <Container className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 py-6">
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              {data?.schedule.enabled
                ? t("dynamic.everyMinutes", {
                    p0: data.schedule.interval_minutes,
                    p1: data.schedule.start,
                    p2: data.schedule.end,
                    p3: data.schedule.timezone,
                  })
                : t(
                    "ui.scheduledCollectionIsDisabledClickCheckUpdatesToCollectNow",
                  )}
            </span>
            <span>
              {t("ui.nextCollection")}
              {dateTime(data?.next_run_at)}{" "}
              {t("ui.temporaryContentIsRetainedFor30Days")}
            </span>
          </div>
          {error && !dialog && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
              <AlertAction>
                <Button variant="ghost" size="xs" onClick={() => setError("")}>
                  {t("ui.closed")}
                </Button>
              </AlertAction>
            </Alert>
          )}
          {data?.manual_check?.status === "failed" && !dialog && (
            <Alert variant="destructive">
              <AlertDescription>
                {systemMessage(data.manual_check.error, t)}
                {t("ui.clickCheckUpdatesToRetry")}
              </AlertDescription>
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
              aria-label={t("ui.monitoredPlatforms")}
              className={cn("space-y-2", styles.accounts)}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">
                  {t("ui.monitoredPlatforms")}
                </h2>
                <span className="text-muted-foreground text-xs">
                  {data?.accounts.length ?? 0}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("ui.dragToReorderCollectedSequentially")}
              </p>
              {data?.accounts.some(
                (a) => !a.mail_folder_id || !a.project_id,
              ) && (
                <p className="text-muted-foreground text-xs">
                  {t(
                    "ui.addAProjectAndMailFolderInSettingsForExistingPlatforms",
                  )}
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
                        aria-label={t("dynamic.othermessage16", {
                          p0: data.unread[a.id],
                        })}
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
                          {!a.enabled && t("ui.paused")}
                        </span>
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("dynamic.configure", { p0: a.name })}
                      onClick={() => openAccount(a)}
                    >
                      <Settings />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("dynamic.delete", { p0: a.name })}
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
                  {t("ui.addPlatform")}
                </Button>
              </CardList>
            </section>
            <div className={styles.mobileTabs}>
              <TabsList className="w-full" aria-label={t("ui.workbenchArea")}>
                <TabsTrigger className="flex-1" value="messages">
                  {t("ui.workPanel")}
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="automations">
                  {t("ui.automation")}
                </TabsTrigger>
              </TabsList>
            </div>
            <WorkbenchPanel
              wide={widePanels}
              value="messages"
              aria-label={t("ui.workPanel")}
              className={cn("space-y-3", styles.messages)}
            >
              <div
                ref={messageTop}
                className="flex items-center justify-between gap-3"
              >
                <h2 className={cn("text-sm font-medium", styles.panelTitle)}>
                  {t("ui.workPanel")}
                </h2>
                <span className="text-muted-foreground text-xs">
                  {active?.name} {active && platforms[active.platform]}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("ui.oldestFirstRetainedFor30DaysFromTheLinkedEmailDate")}
              </p>
              <Tabs
                value={messageState}
                onValueChange={(v) => {
                  setPage(1);
                  setMessageState(String(v));
                }}
              >
                <TabsList variant="line" aria-label={t("ui.processingStatus")}>
                  <TabsTrigger value="pending">{t("ui.pending")}</TabsTrigger>
                  <TabsTrigger value="processed">
                    {t("ui.processed")}
                  </TabsTrigger>
                  <TabsTrigger value="ignored">{t("ui.dismissed")}</TabsTrigger>
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
                        ? t("ui.noMatchingMessagesForThisPlatformAndTimeRange")
                        : t("ui.addAPlatformToCollectCustomerInformation")}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(
                        "ui.issueDetailsAreCollectedAfterMailRulesMoveNotificationsIntoTheLinked",
                      )}
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
                      aria-label={t("dynamic.viewMessage", {
                        p0: m.payload.key,
                        p1: m.payload.title,
                      })}
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
                            aria-label={t("dynamic.removeMessage", {
                              p0: m.payload.key,
                            })}
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
                            {m.is_read ? t("ui.read") : t("ui.unread")}
                          </Badge>
                          <Badge variant="outline">
                            {m.dismissed
                              ? t("ui.dismissed")
                              : m.submitted
                                ? t("ui.processed")
                                : t("ui.pending")}
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
                            {t("ui.latestSourceEmail")}{" "}
                            {dateTime(m.resource_source.timestamp)}
                            {!m.resource_source.mail_id &&
                              t("ui.expiredOrMovedOutOfTheFolder")}
                          </Button>
                        )}

                        <p className="text-muted-foreground line-clamp-4 text-sm break-words whitespace-pre-wrap">
                          {m.payload.body}
                        </p>
                        {m.note && (
                          <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-wrap">
                            {t("ui.notes")}
                            {m.note}
                          </p>
                        )}
                      </CardContent>
                    </DragCard>
                  ))}
                </CardList>
              )}
              {data && data.total_messages > 0 && (
                <nav
                  aria-label={t("ui.workPanelPagination")}
                  className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 pb-20 sm:pb-3"
                >
                  <span className="text-muted-foreground text-xs">
                    {t("ui.total2")}
                    {data.total_messages} {t("ui.itemsPage")}
                    {data.page} /{" "}
                    {Math.max(
                      1,
                      Math.ceil(data.total_messages / data.page_size),
                    )}{" "}
                    {t("ui.page")}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loading || busy || data.page <= 1}
                      onClick={() => changePage(data.page - 1)}
                    >
                      {t("ui.previous")}
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
                      {t("ui.next")}
                    </Button>
                  </div>
                </nav>
              )}
            </WorkbenchPanel>
            <WorkbenchPanel
              wide={widePanels}
              value="automations"
              aria-label={t("ui.automation")}
              className={cn("space-y-3", styles.automations)}
            >
              <div className="flex items-center justify-between">
                <h2 className={cn("text-sm font-medium", styles.panelTitle)}>
                  {t("ui.automation")}
                </h2>
                <span className="text-muted-foreground text-xs">
                  {t("ui.sequentialPolling")}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("ui.independentExecutionFifoWithinEachCard")}
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
                          aria-label={t("dynamic.configure", { p0: a.name })}
                          onClick={() => void openAutomation(a)}
                        >
                          <Settings2 />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("dynamic.delete", { p0: a.name })}
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
                              {t("ui.issuesOnlySubmissionIsNotAvailableYet")}
                            </p>
                            <span className="text-muted-foreground text-xs">
                              {t("ui.notAcceptingMessagesYet")}
                            </span>
                          </>
                        ) : (
                          <>
                            <p className="text-xs">
                              {counts.running
                                ? t("ui.running2")
                                : t("ui.waitingForTasks")}{" "}
                              {counts.running ?? 0} {t("ui.queued")}
                              {counts.queued ?? 0}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {a.steps.length} {t("ui.steps")}
                              {a.steps.some((s) => s.type === "ticket") &&
                                t("ui.usesTheMessageProject")}
                            </p>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto self-start p-0 text-xs"
                              onClick={() =>
                                openDialog({ type: "history", automation: a })
                              }
                            >
                              {t("ui.completed")}
                              {counts.completed ?? 0} {t("ui.failed")}{" "}
                              {counts.failed ?? 0} {t("ui.executionHistory2")}
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
                  {t("ui.newAutomation")}
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
            title={t("dynamic.deletemessage23", {
              p0:
                removeConfig.kind === "accounts"
                  ? t("ui.platform")
                  : t("ui.automation"),
            })}
            description={t(
              "dynamic.deletingPreventsFutureUseQueuedJobsContinueHistoryFollowsThe",
              { p0: removeConfig.name },
            )}
            destructive
            busy={removing}
            error={removeError}
            confirmLabel={t("ui.confirmDeletion")}
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
                setNotice(t("ui.deleted"));
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
            title={t("ui.removeThisMessage")}
            description={t(
              "dynamic.dismissUpdatesRemainDismissedAndAreMarkedUnreadTheMessage",
              { p0: removeMessage.payload.title },
            )}
            destructive
            busy={removing}
            error={removeError}
            confirmLabel={t("ui.confirmRemoval")}
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
                setNotice(t("ui.messageRemoved"));
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
                  ? t(
                      "ui.thisScheduleControlsPlatformCollectionOnlyAutomationExecutionIsIndependent",
                    )
                  : dialog?.type === "automation"
                    ? t(
                        "ui.combineOperationsInOrderQueuedTasksUseASnapshotOfTheSteps",
                      )
                    : dialog?.type === "history"
                      ? t(
                          "dynamic.automationFailedJobsCanBeRetriedAndRequeued",
                          { p0: dialog.automation.name },
                        )
                      : t(
                          "ui.allSettingsAndDataAreVisibleOnlyToTheCurrentAccount",
                        )}
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
                    <ScheduleForm
                      schedule={schedule}
                      onChange={setSchedule}
                      errors={fieldErrors}
                    />
                  )}
                  {dialog?.type === "account" && (
                    <AccountForm
                      account={account}
                      onChange={setAccount}
                      errors={fieldErrors}
                      accountError={dialog.account?.error}
                      projectLabels={projectLabels}
                      setProjectLabels={setProjectLabels}
                      mailData={mailData}
                    />
                  )}
                  {dialog?.type === "automation" &&
                    (dialog.automation?.kind === "tapd" ? (
                      <p className="text-muted-foreground py-8">
                        {t(
                          "ui.importTypeIssueSubmissionAndConfigurationWillBeAvailableLaterMessagesAre",
                        )}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <Field>
                          <FieldLabel htmlFor="workbench-field-15">
                            {t("ui.automationName")}
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
                                aria-label={t("dynamic.step", { p0: i + 1 })}
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
                                {Object.entries(localizedStepLabels).map(
                                  ([k, v]) => (
                                    <NativeSelectOption key={k} value={k}>
                                      {v}
                                    </NativeSelectOption>
                                  ),
                                )}
                              </NativeSelect>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("ui.moveStepUp")}
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
                                aria-label={t("ui.moveStepDown")}
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
                                aria-label={t("ui.deleteStep")}
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
                                aria-label={t("ui.aiInstructions")}
                                value={step.instruction ?? ""}
                                placeholder={t(
                                  "ui.describeTheProcessingRequirementsPreserveSourceFacts",
                                )}
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
                                {t(
                                  "ui.theTargetProjectFollowsTheMonitoredProjectLinkedToThisMessage",
                                )}
                              </p>
                            )}
                            {(step.type === "map" ||
                              step.type === "ticket") && (
                              <Field>
                                <FieldLabel htmlFor={`workbench-field-17-${i}`}>
                                  {t("ui.priority")}
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
                                    {t("ui.critical")}
                                  </NativeSelectOption>
                                  <NativeSelectOption value="major">
                                    {t("ui.major")}
                                  </NativeSelectOption>
                                  <NativeSelectOption value="trivial">
                                    {t("ui.trivial")}
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
                          {t("ui.addOperation")}
                        </Button>
                      </div>
                    ))}
                  {dialog?.type === "message" && (
                    <div className="space-y-3">
                      {!!dialog.message.mails?.length && (
                        <div className="space-y-1">
                          <p className="text-muted-foreground text-xs">
                            {t(
                              "ui.linkedEmailOpeningTheOriginalSynchronizesItsReadStatus",
                            )}
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
                                m.id && t("ui.latestSource")}
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
                              t("ui.restoredToPending"),
                              true,
                            )
                          }
                        >
                          {t("ui.restoreToPending")}
                        </Button>
                      )}
                      {!!dialog.message.jobs?.length && (
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium">
                            {t("ui.automationHistory")}
                          </h4>
                          {dialog.message.jobs.map((job) => (
                            <div
                              key={job.id}
                              className="space-y-2 rounded-md border p-3 text-xs"
                            >
                              <p>
                                {
                                  {
                                    queued: t("ui.queued2"),
                                    running: t("ui.running3"),
                                    completed: t("ui.completed"),
                                    failed: t("ui.failed2"),
                                  }[job.status]
                                }{" "}
                                · {job.step_index}/{job.steps.length}{" "}
                                {t("ui.step")} {dateTime(job.queued_at)}
                              </p>
                              {job.steps.map((step, i) => (
                                <p key={i}>
                                  {i + 1}. {localizedStepLabels[step.type]} ·{" "}
                                  {i < job.step_index
                                    ? t("ui.done")
                                    : i === job.step_index &&
                                        job.status === "running"
                                      ? t("ui.running3")
                                      : t("ui.incomplete")}
                                </p>
                              ))}
                              {job.logs.map((log, i) => (
                                <p
                                  className="text-muted-foreground whitespace-pre-wrap"
                                  key={i}
                                >
                                  {dateTime(log.at)}{" "}
                                  {systemMessage(log.message, t)}
                                </p>
                              ))}
                              {job.error && (
                                <p className="text-destructive">
                                  {systemMessage(job.error, t)}
                                </p>
                              )}
                              {job.snapshot.summary && (
                                <p className="whitespace-pre-wrap">
                                  {job.snapshot.summary}
                                </p>
                              )}
                              {job.ticket_id && (
                                <a className="underline" href="/ticket">
                                  {t("ui.goToTicket")}
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
                                      t("ui.queuedAgain"),
                                      true,
                                    )
                                  }
                                >
                                  {t("ui.retry")}
                                </Button>
                              )}
                            </div>
                          ))}
                          {(dialog.message.jobs_total ?? 0) > 10 && (
                            <nav
                              aria-label={t("ui.messageExecutionPagination")}
                              className="flex flex-wrap items-center justify-between gap-2"
                            >
                              <span className="text-muted-foreground text-xs">
                                {t("ui.total2")}
                                {dialog.message.jobs_total} {t("ui.runsPage")}{" "}
                                {dialog.message.jobs_page ?? 1} {t("ui.page")}
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
                                      }, t("ui.executionHistoryUpdated"));
                                    }}
                                  >
                                    {offset < 0
                                      ? t("ui.previous")
                                      : t("ui.next")}
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
                          {t("ui.viewSource")}
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                      {dialog.message.payload.attachments?.map((a, i) => (
                        <p key={i} className="text-xs">
                          {t("ui.attachments")}
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
                          {t("ui.notes2")}
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
                          {t("ui.submitToAutomation")}
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
                      {messageSubmitted
                        ? t("ui.submittedToAutomation")
                        : t("ui.submitAndEnqueue")}
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
                          errors["workbench-field-8"] = t(
                            "ui.enterACustomerAccountName",
                          );
                        if (!account.base_url.trim())
                          errors["workbench-field-10"] = t(
                            "ui.enterAPlatformUrl",
                          );
                        if (!account.username.trim())
                          errors["workbench-field-11"] = t("ui.enterAUsername");
                        if (!account.id && !account.password.trim())
                          errors["workbench-field-12"] = t(
                            "ui.enterCredentials",
                          );
                      }
                      if (
                        dialog?.type === "automation" &&
                        !automation.name.trim()
                      )
                        errors["workbench-field-15"] = t(
                          "ui.enterAnAutomationName",
                        );
                      if (dialog?.type === "schedule" && schedule) {
                        if (!schedule.start)
                          errors["workbench-field-5"] = t(
                            "ui.selectAStartTime",
                          );
                        if (!schedule.end || schedule.end <= schedule.start)
                          errors["workbench-field-6"] = t(
                            "ui.endTimeMustBeAfterStartTime",
                          );
                        try {
                          new Intl.DateTimeFormat(locale, {
                            timeZone: schedule.timezone,
                          });
                        } catch {
                          errors["workbench-field-7"] = t(
                            "ui.enterAValidIanaTimeZone",
                          );
                        }
                      }
                      setFieldErrors(errors);
                      if (Object.keys(errors).length) return;
                      if (dialog?.type === "schedule" && schedule)
                        void perform(
                          () => api.put(`${endpoint}/schedule`, schedule),
                          t("ui.collectionScheduleSaved"),
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
                          t("ui.platformSaved"),
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
                          t("ui.automationSaved"),
                        );
                      }
                      if (dialog?.type === "message")
                        void perform(
                          () =>
                            api.put(
                              `${endpoint}/messages/${dialog.message.id}/note`,
                              { note },
                            ),
                          t("ui.notesSaved"),
                        );
                    }}
                  >
                    {busy && <Loader2 className="animate-spin" />}
                    {t("ui.save")}
                    {dialog?.type === "message"
                      ? t("ui.notes2")
                      : t("ui.settings")}
                  </Button>
                </DialogFooter>
              )}
          </DialogContent>
        </Dialog>
      </div>
    </WorkbenchDragCards>
  );
}
