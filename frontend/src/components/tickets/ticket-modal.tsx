"use client";

import { isAxiosError } from "axios";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import {
  type ReactElement,
  cloneElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CatalogCombobox,
  ConfirmDialog,
} from "@/components/catalog/catalog-ui";
import { SearchSelect } from "@/components/catalog/search-select";
import TicketAttachments, {
  type PendingAttachment,
} from "@/components/files/ticket-attachments";
import { Button } from "@/components/ui/base/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/base/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import {
  FieldError,
  FieldLabel,
  Field as FormField,
} from "@/components/ui/base/field";
import { Input } from "@/components/ui/base/input";
import { ScrollArea } from "@/components/ui/base/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/base/tabs";
import { Textarea } from "@/components/ui/base/textarea";
import { toast } from "@/components/ui/base/toast";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { uploadManager } from "@/lib/upload-manager";
import {
  TICKET_PRIORITY_CONFIG,
  TICKET_SOURCES,
  TICKET_STATUS_CONFIG,
  type Ticket,
  TicketPriority,
  TicketStatus,
  type UserBrief,
} from "@/types/ticket";
import { TicketSelect } from "./ticket-select";

function Markdown({ children }: { children: string }) {
  const t = useUiTranslations();

  return (
    <div className="[&_a]:text-primary [&_pre]:bg-muted space-y-3 text-sm leading-7 break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children || t("ui.noContentYet")}
      </ReactMarkdown>
    </div>
  );
}
function draftOf(t?: Ticket, self = "") {
  return {
    title: t?.title ?? "",
    description: t?.description ?? "",
    project_id: t?.project_id ?? "",
    source: t?.source ?? "Email",
    source_number: t?.source_number ?? "",
    source_url: t?.source_url ?? "",
    raw_report: t?.raw_report ?? "",
    tapd_created: t?.tapd_created ?? false,
    tapd_url: t?.tapd_url ?? "",
    priority: t?.priority ?? TicketPriority.major,
    status: t?.status ?? TicketStatus.open,
    status_note: t?.status_note ?? "",
    next_plan: t?.next_plan ?? "",
    notes: t?.notes ?? "",
    assignee_id: t?.assignee?.id ?? self,
  };
}

export default function TicketModal({
  ticket,
  startEditing = false,
  onClose,
  onSuccess,
}: {
  ticket?: Ticket;
  startEditing?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const locale = useLocale();

  const t = useUiTranslations();
  const localizedTICKET_STATUS_CONFIG = translateLabels(
    TICKET_STATUS_CONFIG,
    t,
  );

  const { data: session } = useSession();
  const [record, setRecord] = useState(ticket);
  const [form, setForm] = useState(() => draftOf(ticket, session?.user.id));
  const [projectName, setProjectName] = useState(ticket?.project_name ?? "");
  const [users, setUsers] = useState<(UserBrief & { is_active: boolean })[]>(
    [],
  );
  const [editing, setEditing] = useState(
    !ticket || (startEditing && ticket.can_edit),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [discardAction, setDiscardAction] = useState<"close" | "cancel">(
    "close",
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingComment, setDeletingComment] = useState("");
  const [tab, setTab] = useState("details");
  const [preview, setPreview] = useState(false);
  const [comment, setComment] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState<string[]>(
    [],
  );
  const uploadsPending = pendingAttachments.some((p) => !p.taskId);
  const discardAttachments = () => {
    for (const p of pendingAttachments) {
      void uploadManager.cancel(p.key);
      if (p.taskId)
        void api.delete(`/api/v1/uploads/${p.taskId}`).catch(() => {});
    }
    setPendingAttachments([]);
    setDeletedAttachmentIds([]);
  };
  const dirty =
    editing &&
    (JSON.stringify(form) !==
      JSON.stringify(draftOf(record, session?.user.id)) ||
      pendingAttachments.length > 0 ||
      deletedAttachmentIds.length > 0);
  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };
  useEffect(() => {
    if (focusInvalid.current) {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
      focusInvalid.current = false;
    }
  }, [fieldErrors]);
  const resetDraft = () => {
    for (const p of pendingAttachments) {
      void uploadManager.cancel(p.key);
      if (p.taskId)
        void api.delete(`/api/v1/uploads/${p.taskId}`).catch(() => {});
    }
    setPendingAttachments([]);
    setDeletedAttachmentIds([]);
    setForm(draftOf(record, session?.user.id));
    setProjectName(record?.project_name ?? "");
    setEditing(false);
    setPreview(false);
    setError("");
    setFieldErrors({});
  };
  const close = () => {
    if (busy) return;
    if (
      dirty ||
      comment.trim() ||
      pendingAttachments.length ||
      deletedAttachmentIds.length
    ) {
      setDiscardAction("close");
      setConfirmClose(true);
    } else onClose();
  };
  useEffect(() => {
    const controller = new AbortController();
    api
      .get("/api/v1/users/", { signal: controller.signal })
      .then(({ data }) => setUsers(data))
      .catch(() => {
        if (!controller.signal.aborted)
          setError(t("ui.failedToLoadAccountsCloseAndTryAgain"));
      });
    return () => controller.abort();
  }, [t]);
  async function refreshRecord() {
    if (!record) return;
    const { data } = await api.get(`/api/v1/tickets/${record.id}`);
    setRecord(data);
    setForm(draftOf(data));
    setProjectName(data.project_name);
    onSuccess();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (uploadsPending) return;
    setError("");
    const errors: Record<string, string> = {};
    for (const key of ["title", "project_id", "assignee_id", "source"] as const)
      if (!form[key].trim()) errors[key] = t("ui.thisFieldIsRequired");
    if (form.tapd_created && !form.tapd_url.trim())
      errors.tapd_url = t("ui.thisFieldIsRequired");
    for (const key of ["source_url", "tapd_url"] as const) {
      if (!form[key].trim()) continue;
      try {
        const url = new URL(form[key].trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        errors[key] = t("ui.enterAValidHttpOrHttpsUrl");
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      focusInvalid.current = true;
      return;
    }
    setBusy(true);
    try {
      const { data } = record
        ? await api.patch(`/api/v1/tickets/${record.id}`, {
            ...form,
            revision: record.revision,
            delete_attachment_ids: deletedAttachmentIds,
            upload_ids: pendingAttachments.map((p) => p.taskId),
          })
        : await api.post("/api/v1/tickets/", {
            ...form,
            upload_ids: pendingAttachments.map((p) => p.taskId),
          });
      setPendingAttachments([]);
      setDeletedAttachmentIds([]);
      window.dispatchEvent(new Event("file-storage-changed"));
      setRecord(data);
      setForm(draftOf(data));
      setProjectName(data.project_name);
      setEditing(false);
      setPreview(false);
      setFieldErrors({});
      toast.add({ title: t("ui.ticketSaved"), type: "success" });
      onSuccess();
    } catch (e) {
      const detail = isAxiosError(e) ? e.response?.data?.detail : undefined;
      if (Array.isArray(detail)) {
        const errors: Record<string, string> = {};
        for (const item of detail) {
          const key = item.loc?.[1];
          if (typeof key === "string" && key in form)
            errors[key] =
              item.type === "string_too_short" || item.type === "missing"
                ? t("ui.thisFieldIsRequired")
                : item.error
                  ? systemMessage(item.error, t)
                  : t("ui.checkThisField");
        }
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
          focusInvalid.current = true;
        } else setError(t("ui.checkTheEnteredValues"));
      } else setError(errorMessage(e, t("ui.saveFailedTryAgain")));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!record) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/api/v1/tickets/${record.id}`, {
        params: { revision: record.revision },
      });
      onSuccess();
      onClose();
      discardAttachments();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: "comment" | "ai") {
    if (!record) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "comment") {
        await api.post(`/api/v1/tickets/${record.id}/comments`, {
          content: comment,
        });
        setComment("");
        setDeletedAttachmentIds([]);
        window.dispatchEvent(new Event("file-storage-changed"));
      } else await api.post(`/api/v1/ai/analyze-ticket/${record.id}`);
      await refreshRecord();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !editing || busy;
  function field(
    name: keyof typeof form,
    label: string,
    child: ReactElement<Record<string, unknown>>,
    required = false,
  ) {
    const id = `ticket-${name}`;
    const message = fieldErrors[name];
    return (
      <FormField data-invalid={Boolean(message)}>
        <FieldLabel htmlFor={id}>
          {label}
          {required && " *"}
        </FieldLabel>
        {cloneElement(child, {
          id,
          "aria-invalid": Boolean(message),
          "aria-describedby": message ? `${id}-error` : undefined,
        })}
        {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
      </FormField>
    );
  }
  const text = (
    key: "title" | "source_number" | "source_url" | "tapd_url" | "status_note",
    label: string,
    required = false,
    maxLength = 500,
  ) =>
    field(
      key,
      label,
      <Input
        aria-label={label}
        value={form[key]}
        disabled={disabled || (key === "tapd_url" && !form.tapd_created)}
        onChange={(e) => set(key, e.target.value)}
        required={required}
        maxLength={maxLength}
        type={key.endsWith("url") ? "url" : "text"}
      />,
      required,
    );
  const area = (key: "raw_report" | "next_plan" | "notes", label: string) =>
    field(
      key,
      label,
      <Textarea
        aria-label={label}
        value={form[key]}
        disabled={disabled}
        onChange={(e) => set(key, e.target.value)}
        maxLength={100000}
        rows={3}
      />,
    );
  const select = (
    key: "priority" | "status",
    label: string,
    config: Record<string, { label: string }>,
  ) =>
    field(
      key,
      label,
      <TicketSelect
        label={label}
        value={form[key]}
        disabled={disabled}
        options={Object.entries(config).map(([value, option]) => ({
          value,
          label: option.label,
        }))}
        onValueChange={(value) => set(key, value as (typeof form)[typeof key])}
      />,
    );
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open) {
          details.cancel();
          if (details.reason === "close-press") close();
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col md:max-w-4xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {record
              ? editing
                ? t("ui.editTicket")
                : t("ui.ticketDetails")
              : t("ui.newTicket")}
            {record && ` · ${record.ticket_no}`}
          </DialogTitle>
          <DialogDescription className="break-words">
            {record?.display_name ??
              t("ui.selectAProjectToLinkItsCustomerAndProductATicketNumber")}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as string)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          {record && (
            <TabsList className="w-fit shrink-0">
              <TabsTrigger value="details" disabled={busy}>
                <FileText />
                {t("ui.details")}
              </TabsTrigger>
              <TabsTrigger value="comments" disabled={editing || busy}>
                <MessageSquare />
                {t("ui.comments")}
                {record.comments?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="ai" disabled={editing || busy}>
                <Sparkles />
                {t("ui.aiAnalysis")}
              </TabsTrigger>
            </TabsList>
          )}
          <ScrollArea className="-mx-4 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [&>[data-slot=scroll-area-viewport]]:min-h-0">
            <div className="px-4 py-1">
              <TabsContent value="details">
                <form
                  ref={formRef}
                  id="ticket-form"
                  noValidate
                  onSubmit={save}
                  className="space-y-6"
                >
                  {record && !record.can_edit && (
                    <p className="bg-muted text-muted-foreground rounded-lg p-3 text-sm">
                      {t(
                        "ui.readOnlyOnlyDevelopersLeadersTheLastEditorOrTheAssigneeCan",
                      )}
                    </p>
                  )}

                  {text("title", t("ui.title"), true)}
                  <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
                    {field(
                      "project_id",
                      t("ui.project"),
                      <SearchSelect
                        label={t("ui.project")}
                        value={form.project_id}
                        selectedLabel={projectName}
                        kind="catalog"
                        url="/api/v1/catalog/projects"
                        disabled={disabled}
                        onChange={(option) => {
                          set("project_id", option.value);
                          setProjectName(option.label);
                        }}
                      />,
                      true,
                    )}
                    {field(
                      "assignee_id",
                      t("ui.assignTo"),
                      <CatalogCombobox
                        label={t("ui.assignTo")}
                        value={form.assignee_id ? [form.assignee_id] : []}
                        options={[
                          ...users
                            .filter(
                              (u) => u.is_active || u.id === form.assignee_id,
                            )
                            .map((u) => ({
                              value: u.id,
                              label: `${u.name} (${u.email})${!u.is_active ? t("ui.inactive") : ""}`,
                            })),
                          ...(record?.assignee &&
                          !users.some((u) => u.id === record.assignee?.id)
                            ? [
                                {
                                  value: record.assignee.id,
                                  label: record.assignee.name,
                                },
                              ]
                            : []),
                          ...(!record &&
                          session?.user.id &&
                          !users.some((u) => u.id === session.user.id)
                            ? [
                                {
                                  value: session.user.id,
                                  label:
                                    session.user.name ?? t("ui.currentAccount"),
                                },
                              ]
                            : []),
                        ]}
                        disabled={disabled}
                        popup
                        required
                        onChange={(values) =>
                          set("assignee_id", values[0] ?? "")
                        }
                      />,
                      true,
                    )}
                    {field(
                      "source",
                      t("ui.issueSource"),
                      <CatalogCombobox
                        label={t("ui.issueSource")}
                        value={form.source ? [form.source] : []}
                        options={TICKET_SOURCES.map((value) => ({
                          value,
                          label: value,
                        }))}
                        disabled={disabled}
                        creatable
                        required
                        onChange={(values) =>
                          set("source", (values[0] ?? "").slice(0, 100))
                        }
                      />,
                      true,
                    )}
                    {text("source_number", t("ui.sourceReference"), false, 200)}
                  </div>
                  {text("source_url", t("ui.sourceUrl"), false, 2000)}
                  {!editing && form.source_url && (
                    <Button
                      variant="link"
                      nativeButton={false}
                      render={
                        <a
                          href={form.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <ExternalLink />
                      {t("ui.openSourceUrl")}
                    </Button>
                  )}
                  <FormField>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel htmlFor="ticket-description">
                        {t("ui.issueSummaryMarkdown")}
                      </FieldLabel>
                      {editing && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setPreview(!preview)}
                        >
                          {preview
                            ? t("ui.continueWriting")
                            : t("ui.previewMarkdown")}
                        </Button>
                      )}
                    </div>
                    {!editing || preview ? (
                      <div className="min-h-24 rounded-lg border p-4">
                        <Markdown>{form.description}</Markdown>
                      </div>
                    ) : (
                      <Textarea
                        id="ticket-description"
                        aria-label={t("ui.issueSummary")}
                        rows={6}
                        maxLength={100000}
                        disabled={busy}
                        placeholder={t(
                          "ui.supportsMarkdownHeadingsListsCodeBlocksAndLinks",
                        )}
                        value={form.description}
                        onChange={(e) => set("description", e.target.value)}
                      />
                    )}
                  </FormField>
                  {area("raw_report", t("ui.originalCustomerReportForAi"))}
                  <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
                    {field(
                      "tapd_created",
                      t("ui.internalTapdTicketCreated"),
                      <TicketSelect
                        label={t("ui.internalTapdTicketCreated")}
                        value={form.tapd_created ? "yes" : "no"}
                        disabled={disabled}
                        options={[
                          { value: "no", label: t("ui.no") },
                          { value: "yes", label: t("ui.yes") },
                        ]}
                        onValueChange={(value) => {
                          set("tapd_created", value === "yes");
                          if (value === "no") set("tapd_url", "");
                        }}
                      />,
                    )}
                    {text("tapd_url", t("ui.tapdUrl"), form.tapd_created, 2000)}
                    {select(
                      "priority",
                      t("ui.severity"),
                      TICKET_PRIORITY_CONFIG,
                    )}
                    {select(
                      "status",
                      t("ui.currentStatus"),
                      localizedTICKET_STATUS_CONFIG,
                    )}
                  </div>
                  {!editing && form.tapd_created && form.tapd_url && (
                    <Button
                      variant="link"
                      nativeButton={false}
                      render={
                        <a
                          href={form.tapd_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <ExternalLink />
                      {t("ui.openTapdTicket")}
                    </Button>
                  )}
                  {text("status_note", t("ui.statusSummary"))}
                  {area("next_plan", t("ui.nextSteps"))}
                  {area("notes", t("ui.notes2"))}
                  {record && (
                    <Collapsible className="rounded-lg border p-3">
                      <CollapsibleTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            className="w-full justify-between"
                          />
                        }
                      >
                        {t("ui.editRecord")}
                        <ChevronDown />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <dl className="grid grid-cols-2 gap-4 p-3 text-sm">
                          {[
                            [t("ui.createdBy"), record.creator.name],
                            [
                              t("ui.created"),
                              new Date(record.created_at).toLocaleString(
                                locale,
                              ),
                            ],
                            [t("ui.updatedBy"), record.updater.name],
                            [
                              t("ui.updated"),
                              new Date(record.updated_at).toLocaleString(
                                locale,
                              ),
                            ],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="mt-1 break-words">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  <TicketAttachments
                    ticketId={record?.id}
                    files={record?.attachments}
                    disabled={busy}
                    canEdit={editing && (!record || !!record.can_edit)}
                    pending={pendingAttachments}
                    onPending={setPendingAttachments}
                    deletedIds={deletedAttachmentIds}
                    onDeleted={setDeletedAttachmentIds}
                  />
                </form>
              </TabsContent>
              <TabsContent value="comments" className="space-y-4">
                {!record?.comments?.length && (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t("ui.noComments")}
                  </p>
                )}
                {record?.comments?.map((c) => (
                  <div className="rounded-lg border p-4" key={c.id}>
                    <p className="text-muted-foreground mb-2 text-xs">
                      {c.author.name} ·{" "}
                      {new Date(c.created_at).toLocaleString(locale)}
                    </p>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {c.content}
                    </p>
                    {record.can_edit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingComment(c.id)}
                      >
                        {locale === "zh-CN" ? "删除评论" : "Delete comment"}
                      </Button>
                    )}
                  </div>
                ))}
                {record?.can_edit && (
                  <FormField>
                    <FieldLabel htmlFor="ticket-comment">
                      {t("ui.addComment")}
                    </FieldLabel>
                    <Textarea
                      id="ticket-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      disabled={busy}
                      maxLength={10000}
                    />
                    <Button
                      type="button"
                      className="self-end"
                      disabled={busy || !comment.trim()}
                      onClick={() => void action("comment")}
                    >
                      {t("ui.postComment")}
                    </Button>
                  </FormField>
                )}
              </TabsContent>
              <TabsContent value="ai" className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  {t(
                    "ui.generateAnalysisFromTheIssueSummaryOriginalReportAndKnowledgeBase",
                  )}
                </p>
                {record?.can_edit && (
                  <Button
                    key="edit"
                    type="button"
                    disabled={busy}
                    onClick={() => void action("ai")}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {busy ? t("ui.analyzing") : t("ui.analyze")}
                  </Button>
                )}
                <Markdown>{record?.ai_analysis ?? ""}</Markdown>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter className="flex-row justify-end">
          {editing ? (
            <>
              <Button
                key="cancel"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (!record) {
                    close();
                    return;
                  }
                  if (dirty) {
                    setDiscardAction("cancel");
                    setConfirmClose(true);
                  } else resetDraft();
                }}
              >
                {t("ui.cancelEditing")}
              </Button>
              <Button
                key="save"
                type="submit"
                form="ticket-form"
                disabled={busy || uploadsPending}
              >
                {busy && <Loader2 className="animate-spin" />}
                {record ? t("ui.saveChanges") : t("ui.createTicket")}
              </Button>
            </>
          ) : (
            record?.can_edit && (
              <>
                <Button
                  key="delete"
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 />
                  {t("ui.delete")}
                </Button>
                {tab === "details" && (
                  <Button
                    key="edit"
                    type="button"
                    disabled={busy}
                    onClick={(event) => {
                      event.preventDefault();
                      setEditing(true);
                      setError("");
                    }}
                  >
                    <Pencil />
                    {t("ui.edit")}
                  </Button>
                )}
              </>
            )
          )}
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmClose}
        title={t("ui.discardUnsavedChanges")}
        description={t("ui.unsavedContentWillBeLostIfDiscarded")}
        confirmLabel={t("ui.discardChanges")}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          if (discardAction === "cancel") resetDraft();
          else {
            discardAttachments();
            onClose();
          }
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t("ui.permanentlyDeleteTicket")}
        description={t(
          "dynamic.permanentlyDeleteItsNumberWillNotBeReusedThisCannot",
          { p0: record?.ticket_no ?? "" },
        )}
        destructive
        busy={busy}
        error={error}
        confirmLabel={t("ui.confirmDeletion")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
      <ConfirmDialog
        open={!!deletingComment}
        confirmLabel={locale === "zh-CN" ? "确认删除" : "Confirm deletion"}
        title={locale === "zh-CN" ? "删除评论" : "Delete comment"}
        description={
          locale === "zh-CN"
            ? "此评论将永久删除，无法恢复。"
            : "This comment will be permanently deleted."
        }
        destructive
        busy={busy}
        error={error}
        onCancel={() => setDeletingComment("")}
        onConfirm={() => {
          if (!record) return;
          setBusy(true);
          void api
            .delete(
              `/api/v1/tickets/${record.id}/comments/${deletingComment}`,
              { params: { revision: record.revision } },
            )
            .then(async () => {
              setDeletingComment("");
              await refreshRecord();
              window.dispatchEvent(new Event("file-storage-changed"));
            })
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      />
    </Dialog>
  );
}
