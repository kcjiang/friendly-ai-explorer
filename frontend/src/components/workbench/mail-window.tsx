"use client";

import {
  ChevronLeft,
  FolderPlus,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CatalogCombobox,
  ConfirmDialog,
} from "@/components/catalog/catalog-ui";
import { Badge } from "@/components/ui/base/badge";
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
import { Field, FieldLabel } from "@/components/ui/base/field";
import { Input } from "@/components/ui/base/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/base/native-select";
import { usePolling } from "@/hooks/use-polling";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type {
  MailItem,
  MailOverview,
  MailRule,
  Mailbox,
} from "@/types/workbench-mail";
import { FloatingWindow } from "./floating-window";
import { MailEditor } from "./mail-editor";
import { MailReader } from "./mail-reader";
import { MailSplitLayout } from "./mail-split-layout";

const endpoint = "/api/v1/workbench/mail";
const blankBox = {
  address: "",
  username: "",
  password: "",
  imap_host: "",
  imap_port: 993,
  imap_security: "ssl" as "ssl" | "starttls",
  smtp_host: "",
  smtp_port: 465,
  smtp_security: "ssl" as "ssl" | "starttls",
};
const blankRule = {
  name: "",
  folder_id: "",
  sender: "",
  keywords: [] as string[],
  enabled: true,
};
type Draft = {
  id: string;
  mailbox_id: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  text: string;
  in_reply_to: string;
  attachments: { name: string; data: string }[];
};
function addresses(value: string) {
  return value
    .split(/[,;；，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function date(value: string) {
  return new Date(value).toLocaleString();
}
function SetupDialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "close-press") onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>邮箱设置与工作台配置独立保存。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-1">
          {children}
        </div>
        {footer && <DialogFooter className="shrink-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function MailWindow({
  open,
  onClose,
  mailId,
  onChanged,
  onUnreadChange,
}: {
  open: boolean;
  onClose: () => void;
  mailId?: string;
  onChanged: () => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [data, setData] = useState<MailOverview>({
    mailboxes: [],
    folders: [],
    rules: [],
    unread: {},
    unread_total: 0,
  });
  const [boxId, setBoxId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [items, setItems] = useState<MailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [mail, setMail] = useState<MailItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [extraRecipients, setExtraRecipients] = useState(false);
  const unreadListener = useRef(onUnreadChange);
  unreadListener.current = onUnreadChange;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [editId, setEditId] = useState("");
  const [box, setBox] = useState(blankBox);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rule, setRule] = useState(blankRule);
  const [ruleId, setRuleId] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [deleteRule, setDeleteRule] = useState<MailRule | null>(null);
  const [discard, setDiscard] = useState(false);
  const opened = useRef("");
  const readVersion = useRef(0);
  const [loadingMail, setLoadingMail] = useState(false);
  function clearReader() {
    readVersion.current++;
    setLoadingMail(false);
    setMail(null);
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await api.get<MailOverview>(endpoint, { signal });
    if (signal?.aborted) return response.data;
    setData(response.data);
    unreadListener.current?.(response.data.unread_total);
    setBoxId((current) =>
      response.data.mailboxes.some((b) => b.id === current)
        ? current
        : (response.data.mailboxes[0]?.id ?? ""),
    );
    return response.data;
  }, []);
  usePolling(load, 5000, open, true, (e) => setError(errorMessage(e)));
  useEffect(() => {
    const folders = data.folders.filter(
      (f) => f.mailbox_id === boxId && f.selectable,
    );
    setFolderId((current) =>
      folders.some((f) => f.id === current)
        ? current
        : (folders.find((f) => f.path.toLowerCase() === "inbox")?.id ??
          folders[0]?.id ??
          ""),
    );
  }, [data.folders, boxId]);
  useEffect(() => {
    setPage(1);
  }, [folderId, search]);
  const listVersion = useRef(0);
  const list = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++listVersion.current;
      if (!folderId) {
        setItems([]);
        setTotal(0);
        return;
      }
      const response = await api.get<{
        items: MailItem[];
        total: number;
        page: number;
      }>(`${endpoint}/folders/${folderId}/messages`, {
        params: { page, q: search },
        signal,
      });
      if (signal?.aborted || version !== listVersion.current) return;
      setPage(response.data.page);
      setItems(response.data.items);
      setTotal(response.data.total);
    },
    [folderId, page, search],
  );
  const currentList = useRef(list);
  currentList.current = list;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void list(controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, list, data]);
  async function act(action: () => Promise<unknown>, message = "已保存") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(typeof result === "string" ? result : message);
      await load();
      await currentList.current();
      onChanged();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const readMail = useCallback(
    async (id: string) => {
      const version = ++readVersion.current;
      setLoadingMail(true);
      setError("");
      try {
        const response = await api.post<MailItem>(
          `${endpoint}/messages/${id}/read`,
          undefined,
          { timeout: 90000 },
        );
        if (version !== readVersion.current) return;
        setMail(response.data);
        setBoxId(response.data.mailbox_id);
        setItems((rows) =>
          rows.map((row) => (row.id === id ? { ...row, is_read: true } : row)),
        );
        void load().catch((e) => setError(errorMessage(e)));
      } catch (e) {
        if (version === readVersion.current) setError(errorMessage(e));
      } finally {
        if (version === readVersion.current) setLoadingMail(false);
      }
    },
    [load],
  );
  useEffect(() => {
    if (!open) {
      opened.current = "";
      readVersion.current++;
      setLoadingMail(false);
      return;
    }
    if (mailId && opened.current !== mailId) {
      if (draft) {
        setNotice("请先发送或放弃当前草稿，再打开关联邮件。");
        return;
      }
      opened.current = mailId;
      void readMail(mailId);
    }
  }, [open, mailId, readMail, draft]);
  function compose(mode: "new" | "reply" | "forward") {
    readVersion.current++;
    setLoadingMail(false);
    const subject =
      mode === "new"
        ? ""
        : (mode === "reply" ? "Re: " : "Fwd: ") + (mail?.subject ?? "");
    const initial =
      mode === "new"
        ? "<p></p>"
        : "<p></p><blockquote>" + (mail?.body_html ?? "") + "</blockquote>";
    setExtraRecipients(false);
    setDraft({
      id: crypto.randomUUID(),
      mailbox_id: boxId,
      to:
        mode === "reply"
          ? (mail?.sender.match(/<([^>]+)>/)?.[1] ?? mail?.sender ?? "")
          : "",
      cc: "",
      bcc: "",
      subject,
      html: initial,
      text: "",
      in_reply_to: mode === "reply" ? (mail?.message_id ?? "") : "",
      attachments: [],
    });
  }
  function editBox(value?: Mailbox) {
    setEditId(value?.id ?? "");
    setBox(
      value
        ? {
            address: value.address,
            username: value.username,
            password: "",
            imap_host: value.imap_host,
            imap_port: value.imap_port,
            imap_security: value.imap_security,
            smtp_host: value.smtp_host,
            smtp_port: value.smtp_port,
            smtp_security: value.smtp_security,
          }
        : blankBox,
    );
    setSetup(true);
  }
  async function download(index: number, name: string) {
    if (!mail) return;
    try {
      const result = await api.get(
        `${endpoint}/messages/${mail.id}/attachments/${index}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(result.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const selectedBox = data.mailboxes.find((b) => b.id === boxId);
  const folders = data.folders.filter(
    (f) => f.mailbox_id === boxId && f.selectable,
  );
  return (
    <>
      <FloatingWindow
        open={open}
        onClose={onClose}
        title="邮箱"
        containScroll
        initialSize={{ width: 1120, height: 740 }}
      >
        <div className="@container/mail flex h-full min-h-0 flex-col gap-2">
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b pb-2">
            <Button
              size="sm"
              disabled={!boxId || !!draft}
              onClick={() => compose("new")}
            >
              <Plus />
              写邮件
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!boxId || busy}
              onClick={() =>
                void act(
                  () => api.post(`${endpoint}/${boxId}/sync`),
                  "已开始收取，完成后自动显示",
                )
              }
            >
              <RefreshCw
                className={
                  selectedBox?.status === "syncing" ? "animate-spin" : ""
                }
              />
              收取全部
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!boxId}
              onClick={() => setFolderOpen(true)}
            >
              <FolderPlus />
              文件夹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!boxId}
              onClick={() => {
                setRulesOpen(true);
                setRule(blankRule);
                setRuleId("");
              }}
            >
              <SlidersHorizontal />
              分类规则
            </Button>
            <Input
              className="ml-auto w-48 min-w-36 flex-1 @[700px]/mail:max-w-80"
              aria-label="搜索邮件主题"
              placeholder="搜索邮件主题"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!draft) clearReader();
              }}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="text-destructive shrink-0 text-sm break-words"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-muted-foreground shrink-0 text-sm">
              {notice}
            </p>
          )}
          {selectedBox?.error && (
            <p role="alert" className="text-destructive shrink-0 text-sm">
              {selectedBox.error}
              <Button
                size="sm"
                variant="link"
                onClick={() => editBox(selectedBox)}
              >
                修改邮箱设置
              </Button>
            </p>
          )}
          <MailSplitLayout
            sidebar={
              <aside className="flex min-h-0 flex-col gap-2 overflow-auto overscroll-contain border-b pb-2 @[700px]/mail:border-r @[700px]/mail:border-b-0 @[700px]/mail:pr-2">
                <div className="flex gap-1">
                  <NativeSelect
                    aria-label="当前邮箱"
                    disabled={!!draft || busy}
                    className="min-w-0 flex-1"
                    value={boxId}
                    onChange={(e) => {
                      setBoxId(e.target.value);
                      clearReader();
                    }}
                  >
                    <NativeSelectOption value="" disabled>
                      选择邮箱
                    </NativeSelectOption>
                    {data.mailboxes.map((b) => (
                      <NativeSelectOption key={b.id} value={b.id}>
                        {b.address}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="添加邮箱"
                    onClick={() => editBox()}
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="@[700px]/mail:hidden"
                    aria-label="设置当前邮箱"
                    disabled={!selectedBox}
                    onClick={() => editBox(selectedBox)}
                  >
                    <Settings2 />
                  </Button>
                </div>
                <Button
                  className="hidden @[700px]/mail:inline-flex"
                  variant="ghost"
                  size="sm"
                  disabled={!selectedBox}
                  onClick={() => editBox(selectedBox)}
                >
                  <Settings2 />
                  邮箱设置
                </Button>
                <NativeSelect
                  aria-label="邮件文件夹"
                  className="@[700px]/mail:hidden"
                  value={folderId}
                  onChange={(e) => {
                    setFolderId(e.target.value);
                    clearReader();
                  }}
                >
                  <NativeSelectOption value="" disabled>
                    选择文件夹
                  </NativeSelectOption>
                  {folders.map((f) => (
                    <NativeSelectOption key={f.id} value={f.id}>
                      {f.path} {data.unread[f.id] || ""}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <div className="hidden space-y-1 @[700px]/mail:block">
                  {data.folders
                    .filter((f) => f.mailbox_id === boxId)
                    .map((f) => (
                      <Button
                        className="h-auto w-full justify-start py-2 text-left"
                        key={f.id}
                        variant={folderId === f.id ? "secondary" : "ghost"}
                        disabled={!f.selectable}
                        onClick={() => {
                          setFolderId(f.id);
                          clearReader();
                        }}
                      >
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{
                            paddingLeft: Math.min(
                              32,
                              (f.path.split(f.delimiter || "/").length - 1) *
                                10,
                            ),
                          }}
                        >
                          {f.path}
                        </span>
                        {!!data.unread[f.id] && (
                          <Badge variant="secondary">{data.unread[f.id]}</Badge>
                        )}
                      </Button>
                    ))}
                </div>
                {!data.mailboxes.length && (
                  <Button variant="outline" onClick={() => editBox()}>
                    <Mail />
                    登录邮箱
                  </Button>
                )}
              </aside>
            }
          >
            <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              {draft ? (
                <>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-1">
                    <p className="text-muted-foreground text-sm">
                      发件人：{selectedBox?.address}
                    </p>
                    <Field
                      orientation="horizontal"
                      className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"
                    >
                      <FieldLabel
                        className="w-14 shrink-0 grow-0"
                        htmlFor="mail-compose-to"
                      >
                        收件人
                      </FieldLabel>
                      <Input
                        className="min-w-0 flex-1"
                        id="mail-compose-to"
                        value={draft.to}
                        onChange={(e) =>
                          setDraft({ ...draft, to: e.target.value })
                        }
                        placeholder="多个地址使用逗号分隔"
                      />
                    </Field>
                    <Collapsible
                      open={extraRecipients}
                      onOpenChange={setExtraRecipients}
                    >
                      <CollapsibleTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-16 h-6 px-1"
                          />
                        }
                      >
                        {extraRecipients
                          ? "收起抄送 / 密送"
                          : "添加抄送 / 密送"}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        {(
                          [
                            ["cc", "抄送"],
                            ["bcc", "密送"],
                          ] as const
                        ).map(([key, label]) => (
                          <Field
                            key={key}
                            orientation="horizontal"
                            className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"
                          >
                            <FieldLabel
                              className="w-14 shrink-0 grow-0"
                              htmlFor={`mail-compose-${key}`}
                            >
                              {label}
                            </FieldLabel>
                            <Input
                              className="min-w-0 flex-1"
                              id={`mail-compose-${key}`}
                              value={draft[key]}
                              onChange={(e) =>
                                setDraft({ ...draft, [key]: e.target.value })
                              }
                              placeholder="多个地址使用逗号分隔"
                            />
                          </Field>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                    <Field
                      orientation="horizontal"
                      className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"
                    >
                      <FieldLabel
                        className="w-14 shrink-0 grow-0"
                        htmlFor="mail-compose-subject"
                      >
                        主题
                      </FieldLabel>
                      <Input
                        className="min-w-0 flex-1"
                        id="mail-compose-subject"
                        value={draft.subject}
                        onChange={(e) =>
                          setDraft({ ...draft, subject: e.target.value })
                        }
                      />
                    </Field>
                    <MailEditor
                      key={draft.id}
                      initial={draft.html}
                      onChange={(html, text) =>
                        setDraft((current) =>
                          current ? { ...current, html, text } : current,
                        )
                      }
                    />
                    <label className="block text-sm">
                      添加附件（每个最多 5MB）
                      <Input
                        type="file"
                        multiple
                        onChange={async (e) => {
                          const files = [...(e.target.files ?? [])];
                          e.target.value = "";
                          for (const file of files) {
                            if (file.size > 5_000_000) {
                              setError("单个附件不能超过5MB");
                              continue;
                            }
                            const content = await new Promise<string>(
                              (resolve) => {
                                const reader = new FileReader();
                                reader.onload = () =>
                                  resolve(String(reader.result).split(",")[1]);
                                reader.readAsDataURL(file);
                              },
                            );
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    attachments: [
                                      ...current.attachments,
                                      { name: file.name, data: content },
                                    ],
                                  }
                                : current,
                            );
                          }
                        }}
                      />
                    </label>
                    {draft.attachments.map((file, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            attachments: draft.attachments.filter(
                              (_, n) => n !== i,
                            ),
                          })
                        }
                      >
                        {file.name}
                        <Trash2 />
                      </Button>
                    ))}
                  </div>
                  <div className="flex shrink-0 gap-2 border-t pt-2">
                    <Button
                      disabled={busy || !draft.to.trim()}
                      onClick={() =>
                        void act(async () => {
                          const { mailbox_id, ...body } = draft;
                          const response = await api.post(
                            `${endpoint}/${mailbox_id}/send`,
                            {
                              ...body,
                              to: addresses(draft.to),
                              cc: addresses(draft.cc),
                              bcc: addresses(draft.bcc),
                            },
                            { timeout: 120000 },
                          );
                          setDraft(null);
                          return response.data.warning || "邮件已发送";
                        }, "发送完成，请查看已发送文件夹")
                      }
                    >
                      <Send />
                      发送
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setDiscard(true)}
                    >
                      放弃草稿
                    </Button>
                  </div>
                </>
              ) : loadingMail ? (
                <p className="text-muted-foreground p-4 text-sm">
                  正在读取邮件并同步已读…
                </p>
              ) : mail ? (
                <>
                  <div className="flex shrink-0 flex-wrap gap-2 border-b pb-2">
                    <Button variant="ghost" size="sm" onClick={clearReader}>
                      <ChevronLeft />
                      返回
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => compose("reply")}
                    >
                      回复
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => compose("forward")}
                    >
                      转发
                    </Button>
                  </div>
                  <MailReader
                    mail={mail}
                    onDownload={(index, name) => void download(index, name)}
                  />
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        className={cn(
                          "hover:bg-muted w-full p-3 text-left",
                          item.rule_id &&
                            "border-l-primary bg-primary/5 border-l-2",
                        )}
                        onClick={() => void readMail(item.id)}
                      >
                        <div className="flex gap-2">
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-sm",
                              !item.is_read && "font-semibold",
                            )}
                          >
                            {!item.is_read && (
                              <span className="bg-primary mr-2 inline-block size-1.5 rounded-full" />
                            )}
                            {item.subject || "（无主题）"}
                          </span>
                          {item.rule_id && (
                            <Badge variant="secondary">已分类</Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-1 truncate text-xs">
                          {item.sender}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {date(item.received_at)}
                        </p>
                      </button>
                    ))}
                    {!items.length && (
                      <p className="text-muted-foreground p-6 text-center text-sm">
                        {selectedBox?.status === "syncing"
                          ? "正在同步最近30天的邮件…"
                          : "此文件夹最近30天没有邮件"}
                      </p>
                    )}
                  </div>
                  <div className="text-muted-foreground flex shrink-0 items-center gap-2 border-t pt-2 text-xs">
                    <span className="mr-auto">
                      {total} 封 · 第 {page} 页
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page * 30 >= total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </>
              )}
            </main>
          </MailSplitLayout>
        </div>
      </FloatingWindow>
      <SetupDialog
        open={open && setup}
        onClose={() => setSetup(false)}
        title={editId ? "邮箱设置" : "登录邮箱"}
        footer={
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const payload = { ...box, password: box.password || null };
                if (editId) await api.put(`${endpoint}/${editId}`, payload);
                else await api.post(endpoint, payload);
                setSetup(false);
              }, "邮箱已保存，开始同步最近30天邮件")
            }
          >
            保存并连接
          </Button>
        }
      >
        <div className="space-y-3 pb-3">
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            使用 IMAP 收取、SMTP 发送。若服务商要求，请填写应用专用密码。
          </p>
          {(
            [
              ["address", "邮箱地址"],
              ["username", "登录账号"],
              ["password", "密码 / 应用专用密码"],
              ["imap_host", "IMAP 服务器"],
              ["smtp_host", "SMTP 服务器"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`mail-login-${key}`}>{label}</FieldLabel>
              <Input
                id={`mail-login-${key}`}
                autoComplete={key === "password" ? "new-password" : "off"}
                type={key === "password" ? "password" : "text"}
                value={box[key]}
                placeholder={
                  key === "password" && editId ? "留空保留原密码" : ""
                }
                onChange={(e) => setBox({ ...box, [key]: e.target.value })}
              />
            </Field>
          ))}
          {(["imap", "smtp"] as const).map((protocol) => (
            <div className="grid grid-cols-2 gap-3" key={protocol}>
              <Field>
                <FieldLabel htmlFor={`mail-${protocol}-port`}>
                  {protocol.toUpperCase()} 端口
                </FieldLabel>
                <Input
                  id={`mail-${protocol}-port`}
                  type="number"
                  min={1}
                  max={65535}
                  value={box[`${protocol}_port`]}
                  onChange={(e) =>
                    setBox({
                      ...box,
                      [`${protocol}_port`]: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`mail-${protocol}-security`}>
                  加密方式
                </FieldLabel>
                <NativeSelect
                  id={`mail-${protocol}-security`}
                  value={box[`${protocol}_security`]}
                  onChange={(e) =>
                    setBox({ ...box, [`${protocol}_security`]: e.target.value })
                  }
                >
                  <NativeSelectOption value="ssl">SSL/TLS</NativeSelectOption>
                  <NativeSelectOption value="starttls">
                    STARTTLS
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
          ))}
        </div>
      </SetupDialog>
      <SetupDialog
        open={open && folderOpen}
        onClose={() => setFolderOpen(false)}
        title="新建邮箱文件夹"
        footer={
          <Button
            disabled={busy || !folderName.trim()}
            onClick={() =>
              void act(async () => {
                await api.post(`${endpoint}/${boxId}/folders`, {
                  name: folderName,
                });
                setFolderOpen(false);
                setFolderName("");
              }, "已创建文件夹，正在同步")
            }
          >
            创建文件夹
          </Button>
        }
      >
        <Field>
          <FieldLabel htmlFor="mail-folder-name">文件夹名称</FieldLabel>
          <Input
            id="mail-folder-name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            将在原邮箱创建，其他客户端也可见。
          </p>
        </Field>
      </SetupDialog>
      <SetupDialog
        open={open && rulesOpen}
        onClose={() => setRulesOpen(false)}
        title="邮件分类规则"
        footer={
          <Button
            disabled={
              busy ||
              !rule.name ||
              !rule.folder_id ||
              (!rule.sender && !rule.keywords.length)
            }
            onClick={() =>
              void act(async () => {
                if (ruleId)
                  await api.put(`${endpoint}/${boxId}/rules/${ruleId}`, rule);
                else await api.post(`${endpoint}/${boxId}/rules`, rule);
                setRule(blankRule);
                setRuleId("");
              }, "规则已保存，下次收取时将移动匹配的原邮件")
            }
          >
            {ruleId ? "保存规则" : "添加规则"}
          </Button>
        }
      >
        <div className="space-y-3 pb-3">
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            发件人和主题条件同时满足才匹配；多个主题关键词满足其一即可。匹配后移动原邮件，不改变已读状态。
          </p>
          {data.rules
            .filter((r) => r.mailbox_id === boxId)
            .map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md border p-2"
              >
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start truncate"
                  onClick={() => {
                    setRuleId(r.id);
                    setRule({
                      name: r.name,
                      folder_id: r.folder_id,
                      sender: r.sender,
                      keywords: r.keywords,
                      enabled: r.enabled,
                    });
                  }}
                >
                  {r.name} · {r.enabled ? "启用" : "停用"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api.put(`${endpoint}/${boxId}/rules/${r.id}`, {
                        name: r.name,
                        folder_id: r.folder_id,
                        sender: r.sender,
                        keywords: r.keywords,
                        enabled: !r.enabled,
                      }),
                    )
                  }
                >
                  {r.enabled ? "停用" : "启用"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除规则 ${r.name}`}
                  onClick={() => setDeleteRule(r)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          <Field>
            <FieldLabel htmlFor="mail-rule-name">规则名称</FieldLabel>
            <Input
              id="mail-rule-name"
              value={rule.name}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="mail-rule-sender">
              发件人邮箱或 @域名
            </FieldLabel>
            <Input
              id="mail-rule-sender"
              value={rule.sender}
              placeholder="jira@sdmctech.com"
              onChange={(e) => setRule({ ...rule, sender: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="mail-rule-keywords">
              主题关键词（逗号分隔）
            </FieldLabel>
            <Input
              id="mail-rule-keywords"
              value={rule.keywords.join(",")}
              placeholder="DRACO-"
              onChange={(e) =>
                setRule({ ...rule, keywords: e.target.value.split(",") })
              }
            />
          </Field>
          <CatalogCombobox
            id="mail-rule-folder"
            label="移动到文件夹"
            value={rule.folder_id ? [rule.folder_id] : []}
            options={folders.map((f) => ({ value: f.id, label: f.path }))}
            onChange={(values) =>
              setRule({ ...rule, folder_id: values[0] ?? "" })
            }
          />
          {ruleId && (
            <Button
              variant="outline"
              onClick={() => {
                setRuleId("");
                setRule(blankRule);
              }}
            >
              取消编辑，新增规则
            </Button>
          )}
        </div>
      </SetupDialog>
      <ConfirmDialog
        open={!!deleteRule}
        title="删除分类规则？"
        description="已移动的邮件保留在当前文件夹中。"
        busy={busy}
        confirmLabel="删除规则"
        onCancel={() => setDeleteRule(null)}
        onConfirm={() => {
          if (deleteRule)
            void act(async () => {
              await api.delete(
                `${endpoint}/${deleteRule.mailbox_id}/rules/${deleteRule.id}`,
              );
              setDeleteRule(null);
            });
        }}
      />
      <ConfirmDialog
        open={discard}
        title="放弃未发送的草稿？"
        description="草稿内容将被清除。"
        busy={busy}
        confirmLabel="放弃草稿"
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          setDraft(null);
          setDiscard(false);
        }}
      />
    </>
  );
}
