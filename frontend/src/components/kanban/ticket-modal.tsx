"use client";

import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SearchSelect } from "@/components/catalog/search-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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

function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 break-words text-sm leading-7 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children || "暂无内容"}
      </ReactMarkdown>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {children}
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
  onClose,
  onSuccess,
}: {
  ticket?: Ticket;
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
  const [editing, setEditing] = useState(!ticket);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState("details");
  const [preview, setPreview] = useState(false);
  const [comment, setComment] = useState("");
  const dirty =
    editing &&
    JSON.stringify(form) !== JSON.stringify(draftOf(record, session?.user.id));
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const close = () => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
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
    if (!form.project_id || !form.assignee_id) {
      setError("请选择所属项目和被分配人。");
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
      onSuccess();
    } catch (e) {
      setError(errorMessage(e, "保存失败，请检查字段。"));
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
  const text = (
    key: "title" | "source_number" | "source_url" | "tapd_url" | "status_note",
    label: string,
    required = false,
    maxLength = 500,
  ) => (
    <Input
      aria-label={label}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      required={required}
      maxLength={maxLength}
      type={key.endsWith("url") ? "url" : "text"}
    />
  );
  const area = (key: "raw_report" | "next_plan" | "notes", label: string) => (
    <Textarea
      aria-label={label}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      maxLength={100000}
      rows={3}
    />
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-w-4xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (busy || dirty) {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="border-b px-6 py-4 pr-12">
          <DialogTitle className="font-semibold">
            {record ? (editing ? "编辑工单" : "工单详情") : "新建工单"}
            {record && ` · ${record.ticket_no}`}
          </DialogTitle>
          <DialogDescription className="mt-1 break-words text-xs text-muted-foreground">
            {record?.display_name ??
              "选择项目后自动引用客户与产品，保存时分配工单编号。"}
          </DialogDescription>
        </div>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          {record && (
            <TabsList className="mx-6 mt-3 w-fit">
              <TabsTrigger value="details" disabled={busy}>详情</TabsTrigger>
              <TabsTrigger value="comments" disabled={editing || busy}>
                评论 ({record.comments?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="ai" disabled={editing || busy}>
                AI 分析
              </TabsTrigger>
            </TabsList>
          )}
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <TabsContent value="details" className="mt-0">
              <form id="ticket-form" onSubmit={save} className="space-y-5">
                {record && !record.can_edit && (
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                    当前为只读模式。仅开发者、领导、最后更新人或被分配人可以修改。
                  </p>
                )}
                {record && !record.project_id && (
                  <p className="text-sm text-amber-600">
                    历史工单尚未关联项目，请在编辑时补选。原编号：
                    {record.legacy_ticket_no}
                  </p>
                )}
                <fieldset disabled={!editing || busy} className="space-y-5">
                  <Field label="标题 *">{text("title", "标题", true)}</Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="所属项目 *">
                      <SearchSelect
                        label="所属项目"
                        value={form.project_id}
                        selectedLabel={projectName}
                        kind="catalog"
                        url="/api/v1/catalog/projects"
                        disabled={!editing || busy}
                        onChange={(o) => {
                          set("project_id", o.value);
                          setProjectName(o.label);
                        }}
                      />
                    </Field>
                    <Field label="分配给 *">
                      <NativeSelect
                        aria-label="分配给"
                        value={form.assignee_id}
                        onChange={(e) => set("assignee_id", e.target.value)}
                        required
                      >
                        <option value="">选择账户</option>
                        {users
                          .filter(
                            (u) => u.is_active || u.id === form.assignee_id,
                          )
                          .map((u) => (
                            <option
                              key={u.id}
                              value={u.id}
                              disabled={!u.is_active}
                            >
                              {u.name} ({u.email})
                              {!u.is_active ? " · 已停用" : ""}
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="缺陷来源 *">
                      <Input
                        aria-label="缺陷来源"
                        list="ticket-sources"
                        value={form.source}
                        onChange={(e) => set("source", e.target.value)}
                        required
                        maxLength={100}
                      />
                      <datalist id="ticket-sources">
                        {TICKET_SOURCES.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label="来源侧编号（可选）">
                      {text("source_number", "来源侧编号", false, 200)}
                    </Field>
                  </div>
                  <Field label="来源链接（可选）">
                    {text("source_url", "来源链接", false, 2000)}
                  </Field>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        简要问题描述 · Markdown
                      </p>
                      {editing && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
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
                        aria-label="简要问题描述"
                        rows={6}
                        maxLength={100000}
                        placeholder="支持标题、列表、代码块和链接等 Markdown 语法"
                        value={form.description}
                        onChange={(e) => set("description", e.target.value)}
                      />
                    )}
                  </div>
                  <Field label="原始客户提报信息（供 AI 读取）">
                    {area("raw_report", "原始客户提报信息")}
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="已创建内部 TAPD 工单">
                      <NativeSelect
                        aria-label="已创建内部 TAPD 工单"
                        value={form.tapd_created ? "yes" : "no"}
                        onChange={(e) => {
                          set("tapd_created", e.target.value === "yes");
                          if (e.target.value === "no") set("tapd_url", "");
                        }}
                      >
                        <option value="no">否</option>
                        <option value="yes">是</option>
                      </NativeSelect>
                    </Field>
                    <Field label="TAPD 链接">
                      <Input
                        aria-label="TAPD 链接"
                        type="url"
                        maxLength={2000}
                        value={form.tapd_url}
                        disabled={!form.tapd_created}
                        required={form.tapd_created}
                        onChange={(e) => set("tapd_url", e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="重要性">
                      <NativeSelect
                        aria-label="重要性"
                        value={form.priority}
                        onChange={(e) =>
                          set("priority", e.target.value as TicketPriority)
                        }
                      >
                        {Object.values(TicketPriority).map((v) => (
                          <option key={v} value={v}>
                            {TICKET_PRIORITY_CONFIG[v].label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="当前状态">
                      <NativeSelect
                        aria-label="当前状态"
                        value={form.status}
                        onChange={(e) =>
                          set("status", e.target.value as TicketStatus)
                        }
                      >
                        {Object.values(TicketStatus).map((v) => (
                          <option key={v} value={v}>
                            {TICKET_STATUS_CONFIG[v].label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                  <Field label="状态简要描述（可选）">
                    {text("status_note", "状态简要描述")}
                  </Field>
                  <Field label="下一步计划">
                    {area("next_plan", "下一步计划")}
                  </Field>
                  <Field label="备注">{area("notes", "备注")}</Field>
                </fieldset>
                {record && (
                  <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground">
                    <div>
                      <dt>创建人</dt>
                      <dd>{record.creator.name}</dd>
                    </div>
                    <div>
                      <dt>创建时间</dt>
                      <dd>
                        {new Date(record.created_at).toLocaleString("zh-CN")}
                      </dd>
                    </div>
                    <div>
                      <dt>更新人</dt>
                      <dd>{record.updater.name}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>
                        {new Date(record.updated_at).toLocaleString("zh-CN")}
                      </dd>
                    </div>
                    {record.legacy_ticket_no && (
                      <div>
                        <dt>历史编号</dt>
                        <dd>{record.legacy_ticket_no}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </form>
            </TabsContent>
            <TabsContent value="comments" className="space-y-4">
              {!record?.comments?.length && (
                <p className="text-sm text-muted-foreground">暂无评论</p>
              )}
              {record?.comments?.map((c) => (
                <div className="rounded-lg border p-4" key={c.id}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {c.author.name} ·{" "}
                    {new Date(c.created_at).toLocaleString("zh-CN")}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{c.content}</p>
                </div>
              ))}
              {record?.can_edit && (
                <div className="space-y-2">
                  <Textarea
                    aria-label="评论内容"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={10000}
                  />
                  <Button
                    type="button"
                    className="text-white"
                    disabled={busy || !comment.trim()}
                    onClick={() => void action("comment")}
                  >
                    发送评论
                  </Button>
                </div>
              )}
            </TabsContent>
            <TabsContent value="ai" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                结合问题描述、原始提报和知识库生成分析。
              </p>
              {record?.can_edit && (
                <Button
                  type="button"
                  disabled={busy}
                  className="text-white"
                  onClick={() => void action("ai")}
                >
                  {busy ? "分析中…" : "开始分析"}
                </Button>
              )}
              <Markdown>{record?.ai_analysis ?? ""}</Markdown>
            </TabsContent>
          </div>
        </Tabs>
        <div className="space-y-3 border-t px-6 py-4">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {confirmClose && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              尚有未保存的修改。
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmClose(false)}
              >
                继续编辑
              </Button>
              <Button type="button" variant="destructive" onClick={onClose}>
                放弃修改
              </Button>
            </div>
          )}
          {confirmDelete && (
            <div role="alert" className="space-y-2 text-sm">
              <p>
                确定永久删除 {record?.ticket_no}？编号不会回收，删除后无法恢复。
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                确认删除
              </Button>{" "}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                保留工单
              </Button>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <div>
              {record?.can_edit && !editing && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 />
                  删除工单
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button
                    key="cancel"
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (record) {
                        setForm(draftOf(record));
                        setProjectName(record.project_name);
                        setEditing(false);
                        setError("");
                        setConfirmClose(false);
                      } else close();
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    key="save"
                    type="submit"
                    form="ticket-form"
                    disabled={busy}
                    className="text-white"
                  >
                    {busy && <Loader2 className="animate-spin" />}
                    {record ? "保存更改" : "创建工单"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={close}
                  >
                    关闭
                  </Button>
                  {record?.can_edit && tab === "details" && (
                    <Button
                      key="edit"
                      disabled={busy}
                      type="button"
                      className="text-white"
                      onClick={() => {
                        setEditing(true);
                        setConfirmDelete(false);
                        setError("");
                      }}
                    >
                      {" "}
                      <Pencil />
                      编辑
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
