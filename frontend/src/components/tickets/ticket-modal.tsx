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
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
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
  return (
    <div className="[&_a]:text-primary [&_pre]:bg-muted space-y-3 text-sm leading-7 break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children || "暂无内容"}
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
  const [tab, setTab] = useState("details");
  const [preview, setPreview] = useState(false);
  const [comment, setComment] = useState("");
  const dirty =
    editing &&
    JSON.stringify(form) !== JSON.stringify(draftOf(record, session?.user.id));
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
    setForm(draftOf(record, session?.user.id));
    setProjectName(record?.project_name ?? "");
    setEditing(false);
    setPreview(false);
    setError("");
    setFieldErrors({});
  };
  const close = () => {
    if (busy) return;
    if (dirty || comment.trim()) {
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
          setError("账户列表加载失败，请关闭后重试。");
      });
    return () => controller.abort();
  }, []);
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
    setError("");
    const errors: Record<string, string> = {};
    for (const key of ["title", "project_id", "assignee_id", "source"] as const)
      if (!form[key].trim()) errors[key] = "请填写此字段。";
    if (form.tapd_created && !form.tapd_url.trim())
      errors.tapd_url = "请填写此字段。";
    for (const key of ["source_url", "tapd_url"] as const) {
      if (!form[key].trim()) continue;
      try {
        const url = new URL(form[key].trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        errors[key] = "请填写有效的 http:// 或 https:// 地址。";
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
          })
        : await api.post("/api/v1/tickets/", form);
      setRecord(data);
      setForm(draftOf(data));
      setProjectName(data.project_name);
      setEditing(false);
      setPreview(false);
      setFieldErrors({});
      toast.add({ title: "工单已保存", type: "success" });
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
                ? "请填写此字段。"
                : String(item.msg ?? "请检查此字段。").replace(
                    /^Value error, /,
                    "",
                  );
        }
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
          focusInvalid.current = true;
        } else setError("请检查填写内容。");
      } else setError(errorMessage(e, "保存失败，请重试。"));
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
            {record ? (editing ? "编辑工单" : "工单详情") : "新建工单"}
            {record && ` · ${record.ticket_no}`}
          </DialogTitle>
          <DialogDescription className="break-words">
            {record?.display_name ??
              "选择项目后自动引用客户与产品，保存时分配工单编号。"}
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
                详情
              </TabsTrigger>
              <TabsTrigger value="comments" disabled={editing || busy}>
                <MessageSquare />
                评论 ({record.comments?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="ai" disabled={editing || busy}>
                <Sparkles />
                AI 分析
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
                      当前为只读模式。仅开发者、领导、最后更新人或被分配人可以修改。
                    </p>
                  )}

                  {text("title", "标题", true)}
                  <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
                    {field(
                      "project_id",
                      "所属项目",
                      <SearchSelect
                        label="所属项目"
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
                      "分配给",
                      <CatalogCombobox
                        label="分配给"
                        value={form.assignee_id ? [form.assignee_id] : []}
                        options={[
                          ...users
                            .filter(
                              (u) => u.is_active || u.id === form.assignee_id,
                            )
                            .map((u) => ({
                              value: u.id,
                              label: `${u.name} (${u.email})${!u.is_active ? " · 已停用" : ""}`,
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
                                  label: session.user.name ?? "当前账户",
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
                      "缺陷来源",
                      <CatalogCombobox
                        label="缺陷来源"
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
                    {text("source_number", "来源侧编号", false, 200)}
                  </div>
                  {text("source_url", "来源链接", false, 2000)}
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
                      打开来源链接
                    </Button>
                  )}
                  <FormField>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel htmlFor="ticket-description">
                        简要问题描述 · Markdown
                      </FieldLabel>
                      {editing && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setPreview(!preview)}
                        >
                          {preview ? "继续编写" : "预览 Markdown"}
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
                        aria-label="简要问题描述"
                        rows={6}
                        maxLength={100000}
                        disabled={busy}
                        placeholder="支持标题、列表、代码块和链接等 Markdown 语法"
                        value={form.description}
                        onChange={(e) => set("description", e.target.value)}
                      />
                    )}
                  </FormField>
                  {area("raw_report", "原始客户提报信息（供 AI 读取）")}
                  <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
                    {field(
                      "tapd_created",
                      "已创建内部 TAPD 工单",
                      <TicketSelect
                        label="已创建内部 TAPD 工单"
                        value={form.tapd_created ? "yes" : "no"}
                        disabled={disabled}
                        options={[
                          { value: "no", label: "否" },
                          { value: "yes", label: "是" },
                        ]}
                        onValueChange={(value) => {
                          set("tapd_created", value === "yes");
                          if (value === "no") set("tapd_url", "");
                        }}
                      />,
                    )}
                    {text("tapd_url", "TAPD 链接", form.tapd_created, 2000)}
                    {select("priority", "重要性", TICKET_PRIORITY_CONFIG)}
                    {select("status", "当前状态", TICKET_STATUS_CONFIG)}
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
                      打开 TAPD 工单
                    </Button>
                  )}
                  {text("status_note", "状态简要描述")}
                  {area("next_plan", "下一步计划")}
                  {area("notes", "备注")}
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
                        编辑记录
                        <ChevronDown />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <dl className="grid grid-cols-2 gap-4 p-3 text-sm">
                          {[
                            ["创建人", record.creator.name],
                            [
                              "创建时间",
                              new Date(record.created_at).toLocaleString(
                                "zh-CN",
                              ),
                            ],
                            ["更新人", record.updater.name],
                            [
                              "更新时间",
                              new Date(record.updated_at).toLocaleString(
                                "zh-CN",
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
                </form>
              </TabsContent>
              <TabsContent value="comments" className="space-y-4">
                {!record?.comments?.length && (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    暂无评论
                  </p>
                )}
                {record?.comments?.map((c) => (
                  <div className="rounded-lg border p-4" key={c.id}>
                    <p className="text-muted-foreground mb-2 text-xs">
                      {c.author.name} ·{" "}
                      {new Date(c.created_at).toLocaleString("zh-CN")}
                    </p>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {c.content}
                    </p>
                  </div>
                ))}
                {record?.can_edit && (
                  <FormField>
                    <FieldLabel htmlFor="ticket-comment">添加评论</FieldLabel>
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
                      发布评论
                    </Button>
                  </FormField>
                )}
              </TabsContent>
              <TabsContent value="ai" className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  结合问题描述、原始提报和知识库生成分析。
                </p>
                {record?.can_edit && (
                  <Button
                    key="edit"
                    type="button"
                    disabled={busy}
                    onClick={() => void action("ai")}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {busy ? "分析中…" : "开始分析"}
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
                取消编辑
              </Button>
              <Button
                key="save"
                type="submit"
                form="ticket-form"
                disabled={busy}
              >
                {busy && <Loader2 className="animate-spin" />}
                {record ? "保存更改" : "创建工单"}
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
                  删除
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
                    编辑
                  </Button>
                )}
              </>
            )
          )}
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmClose}
        title="放弃未保存的修改？"
        description="尚有未保存的内容，放弃后将无法恢复。"
        confirmLabel="放弃修改"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          if (discardAction === "cancel") resetDraft();
          else onClose();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="永久删除工单？"
        description={`确定永久删除 ${record?.ticket_no ?? ""}？编号不会回收，删除后无法恢复。`}
        destructive
        busy={busy}
        error={error}
        confirmLabel="确认删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </Dialog>
  );
}
