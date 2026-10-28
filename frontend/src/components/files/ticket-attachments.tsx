"use client";

import {
  Download,
  File,
  Folder,
  Paperclip,
  Pause,
  Play,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useLocale } from "next-intl";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/base/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/base/code-block";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { type UploadReceipt, uploadManager } from "@/lib/upload-manager";

export type TicketAttachment = {
  pending_task_id?: string;
  id: string;
  name: string;
  size: number;
  thumbnail_size: number;
  media_type?: string;
  ticket_id?: string;
  creator?: { name: string };
  created_at?: string;
  is_dir?: boolean;
  path?: string;
};
export type PendingAttachment = {
  key: string;
  taskId?: string;
  name: string;
  error?: string;
};
const EMPTY: ReturnType<typeof uploadManager.snapshot> = [];
export default function TicketAttachments({
  ticketId,
  files = [],
  canEdit = false,
  disabled = false,
  pending,
  onPending,
  deletedIds = [],
  onDeleted,
}: {
  ticketId?: string;
  files?: TicketAttachment[];
  canEdit?: boolean;
  disabled?: boolean;
  pending?: PendingAttachment[];
  onPending?: (value: PendingAttachment[]) => void;
  deletedIds?: string[];
  onDeleted?: (ids: string[]) => void;
}) {
  const editable = canEdit && !disabled;
  const locale = useLocale();
  const d = (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
  const jobs = useSyncExternalStore(
    uploadManager.subscribe,
    uploadManager.snapshot,
    () => EMPTY,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<TicketAttachment | null>(null);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState<TicketAttachment | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<"files" | "pending">("files");
  const [path, setPath] = useState("");
  const [choices, setChoices] = useState<TicketAttachment[]>([]);
  const pendingRef = useRef(pending || []);
  pendingRef.current = pending || [];
  const change = useCallback(
    (value: PendingAttachment[]) => {
      pendingRef.current = value;
      onPending?.(value);
    },
    [onPending],
  );
  useEffect(() => {
    if (!picker) return;
    const abort = new AbortController();
    if (pickerMode === "pending") {
      void api
        .get<UploadReceipt[]>("/api/v1/uploads", { signal: abort.signal })
        .then((r) =>
          setChoices(
            r.data
              .filter(
                (t) =>
                  t.purpose === "attachment" &&
                  t.status === "complete" &&
                  !t.context.bound &&
                  (!t.context.ticket_id || t.context.ticket_id === ticketId),
              )
              .map((t) => ({
                id: t.id,
                pending_task_id: t.id,
                name: t.filename,
                size: t.size,
                thumbnail_size: 0,
              })),
          ),
        )
        .catch((e) => {
          if (!abort.signal.aborted) setError(errorMessage(e));
        });
      return () => abort.abort();
    }
    void api
      .get("/api/v1/files/entries", {
        params: { space: "personal", path, page_size: 100 },
        signal: abort.signal,
      })
      .then((r) => setChoices(r.data.items))
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e));
      });
    return () => abort.abort();
  }, [picker, path, pickerMode, ticketId]);
  useEffect(() => {
    if (!preview) return;
    setText("");
    const abort = new AbortController();
    if (/\.(txt|log|md|markdown|json|csv|sh|xml|ya?ml)$/i.test(preview.name))
      void api
        .get(`/api/v1/files/${preview.id}/content`, { signal: abort.signal })
        .then((r) => setText(r.data.content))
        .catch((e) => {
          if (!abort.signal.aborted) setError(errorMessage(e));
        });
    return () => abort.abort();
  }, [preview]);
  function add(files: FileList | null) {
    if (!files || !onPending || !editable) return;
    for (const file of Array.from(files)) {
      const task = uploadManager.enqueue(file, {
        purpose: "attachment",
        ticket_id: ticketId,
        conflict: "keep",
      });
      change([...pendingRef.current, { key: task.key, name: file.name }]);
      void task.promise
        .then((r) => {
          change(
            pendingRef.current.map((p) =>
              p.key === task.key ? { ...p, taskId: r.id } : p,
            ),
          );
        })
        .catch((e) => {
          change(
            pendingRef.current.map((p) =>
              p.key === task.key ? { ...p, error: errorMessage(e) } : p,
            ),
          );
        });
    }
  }
  // A retried task may complete after its original promise rejected.
  useEffect(() => {
    const next = pendingRef.current.map((p) => {
      const job = jobs.find((j) => j.key === p.key);
      return job?.phase === "complete" && job.server
        ? { ...p, taskId: job.server.id, error: undefined }
        : p;
    });
    if (
      next.some(
        (p, i) =>
          p.taskId !== pendingRef.current[i]?.taskId ||
          p.error !== pendingRef.current[i]?.error,
      )
    )
      change(next);
  }, [jobs, change]);
  function remove() {
    if (!deleting || !onDeleted) return;
    onDeleted([...deletedIds, deleting.id]);
    setDeleting(null);
  }
  async function copy(file: TicketAttachment) {
    if (!editable) return;
    if (file.pending_task_id) {
      if (!pendingRef.current.some((p) => p.taskId === file.pending_task_id))
        change([
          ...pendingRef.current,
          { key: file.id, taskId: file.pending_task_id, name: file.name },
        ]);
      setPicker(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.post(
        "/api/v1/uploads/from-entry",
        { entry_id: file.id, ticket_id: ticketId },
        { timeout: 600000 },
      );
      change([
        ...pendingRef.current,
        { key: r.data.id, taskId: r.data.id, name: file.name },
      ]);
      setPicker(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-medium">
          <Paperclip className="size-4" />
          {d("Attachments", "附件")}
        </span>
        {editable && onPending && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => input.current?.click()}
            >
              <Upload />
              {d("Upload", "上传")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPath("");
                setPickerMode("files");
                setPicker(true);
              }}
            >
              <Folder />
              {d("From my space", "从我的空间选择")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPickerMode("pending");
                setPicker(true);
              }}
            >
              {d("Pending attachments", "待关联附件")}
            </Button>
          </>
        )}
      </div>
      {editable && (
        <p className="text-muted-foreground text-xs">
          {d(
            "Attachments belong to the ticket and use only the team pool. Files cannot be edited; deletions apply when saving. Selecting from personal space creates an independent copy.",
            "附件归工单管理，仅计入团队总池。上传后不可修改；删除在保存工单后生效。从个人空间选择会创建独立副本。",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {files.map((file) => (
        <div
          className="flex items-center gap-2 rounded-lg border p-2 text-sm"
          key={file.id}
        >
          {file.thumbnail_size > 0 ? (
            <Image
              unoptimized
              width={48}
              height={48}
              alt=""
              className="size-12 rounded object-cover"
              src={`/api/files/${file.id}/download?thumbnail=1`}
            />
          ) : (
            <File className="size-5 shrink-0" />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left hover:underline"
            onClick={() => {
              setError("");
              setPreview(file);
            }}
          >
            <span
              className={
                deletedIds.includes(file.id)
                  ? "text-muted-foreground line-through"
                  : ""
              }
            >
              {file.name}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">
              {(file.size / 1024 ** 2).toFixed(2)} MiB · {file.creator?.name}
              {file.created_at
                ? ` · ${new Date(file.created_at).toLocaleString(locale)}`
                : ""}
            </span>
          </button>
          <a
            href={`/api/files/${file.id}/download`}
            download={file.name}
            aria-label={d("Download", "下载")}
            className="p-2"
          >
            <Download className="size-4" />
          </a>
          {editable && ticketId && onDeleted && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={
                  deletedIds.includes(file.id)
                    ? d("Undo attachment deletion", "撤销附件删除")
                    : d("Delete attachment", "删除附件")
                }
                onClick={() =>
                  deletedIds.includes(file.id)
                    ? onDeleted?.(deletedIds.filter((id) => id !== file.id))
                    : setDeleting(file)
                }
              >
                {deletedIds.includes(file.id) ? <Undo2 /> : <Trash2 />}
              </Button>
            </>
          )}
        </div>
      ))}
      {(pending || []).map((p) => (
        <div
          key={p.key}
          className="flex items-center gap-2 rounded border border-dashed p-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate">
            {p.name} ·{" "}
            {p.taskId
              ? d("Ready to attach", "待提交关联")
              : p.error ||
                `${d("Uploading", "上传中")} ${jobs.find((j) => j.key === p.key)?.percent || 0}%`}
          </span>
          {!p.taskId &&
            jobs.some(
              (j) =>
                j.key === p.key &&
                ["queued", "hashing", "uploading", "paused"].includes(j.phase),
            ) && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={
                  jobs.find((j) => j.key === p.key)?.phase === "paused"
                    ? d("Resume upload", "继续上传")
                    : d("Pause upload", "暂停上传")
                }
                onClick={() => {
                  if (jobs.find((j) => j.key === p.key)?.phase === "paused")
                    uploadManager.resume(p.key);
                  else uploadManager.pause(p.key);
                }}
              >
                {jobs.find((j) => j.key === p.key)?.phase === "paused" ? (
                  <Play />
                ) : (
                  <Pause />
                )}
              </Button>
            )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={d("Cancel attachment", "取消附件")}
            onClick={() => {
              void uploadManager.cancel(p.key);
              if (p.taskId && !jobs.some((j) => j.key === p.key))
                void api.delete(`/api/v1/uploads/${p.taskId}`).catch(() => {});
              change(pendingRef.current.filter((x) => x.key !== p.key));
            }}
          >
            <X />
          </Button>
        </div>
      ))}
      {!!deletedIds.length && (
        <p className="text-muted-foreground text-xs">
          {d("Pending deletions", "待删除附件")}: {deletedIds.length} ·{" "}
          {d("Applies when saving the ticket", "保存工单后生效")}
        </p>
      )}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <Dialog
        open={!!preview}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {preview &&
            (/\.(png|jpe?g|gif|webp)$/i.test(preview.name) ? (
              <Image
                unoptimized
                width={1200}
                height={800}
                alt={preview.name}
                className="max-h-[65dvh] w-full object-contain"
                src={`/api/files/${preview.id}/download?preview=1`}
              />
            ) : /\.(mp4|webm|ogg)$/i.test(preview.name) ? (
              <video
                controls
                preload="metadata"
                className="max-h-[65dvh] w-full"
                src={`/api/files/${preview.id}/download?preview=1`}
              />
            ) : /\.pdf$/i.test(preview.name) ? (
              <iframe
                title={preview.name}
                className="h-[60dvh] w-full"
                src={`/api/files/${preview.id}/download?preview=1`}
              />
            ) : text ? (
              <CodeBlock>
                <CodeBlockContent className="max-h-[60dvh]">
                  {text}
                </CodeBlockContent>
              </CodeBlock>
            ) : (
              <p className="text-muted-foreground text-sm">
                {d(
                  "Download to view unsupported formats.",
                  "此格式可下载后查看。",
                )}
              </p>
            ))}
        </DialogContent>
      </Dialog>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {d("Copy from my space", "从我的空间复制附件")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs">/{path}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!path}
            onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}
          >
            {d("Parent folder", "返回上级")}
          </Button>
          <div className="max-h-80 space-y-1 overflow-auto">
            {choices.map((file) => (
              <Button
                type="button"
                key={file.id}
                variant="ghost"
                className="w-full justify-start"
                disabled={busy}
                onClick={() =>
                  file.is_dir ? setPath(file.path || "") : void copy(file)
                }
              >
                {file.is_dir ? <Folder /> : <File />}
                <span className="truncate">{file.name}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!busy && !v) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{d("Delete attachment", "删除附件")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {d(
              "Mark this attachment for deletion? Saving the ticket permanently deletes it and its thumbnail. Cancel editing to keep it.",
              "将此附件标记为待删除？保存工单后永久清理文件和缩略图；取消编辑则保留附件。",
            )}
          </p>
          <Button
            type="button"
            disabled={busy}
            variant="destructive"
            onClick={remove}
          >
            {d("Delete", "删除")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
