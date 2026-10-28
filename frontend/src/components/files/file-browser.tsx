"use client";

import {
  ArrowLeft,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  History,
  Loader2,
  Move,
  Pencil,
  RefreshCw,
  Settings2,
  Share2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TopNav } from "@/components/nav";
import { Button } from "@/components/ui/base/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/base/code-block";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import { Input } from "@/components/ui/base/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/base/table";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { enqueueUpload } from "@/lib/upload-manager";
import type { Ticket } from "@/types/ticket";

type Space =
  | "public"
  | "personal"
  | "knowledge"
  | "shared"
  | "trash"
  | "attachments";
type Entry = {
  id: string;
  space: string;
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  creator: { id: string; name: string } | null;
  modifiers: { id: string; name: string }[];
  updated_at: string;
  deleted_at?: string;
  document_id?: string;
  sha256?: string;
  index_status?: string;
  ticket_id?: string;
  ticket_name?: string;
  created_at?: string;
  thumbnail_size?: number;
};
type User = { id: string; name: string; is_active: boolean };
type Usage = {
  reserved_bytes: number;
  personal_reserved_bytes: number;
  total_bytes: number;
  used_bytes: number;
  personal_bytes: number;
  personal_limit: number;
  knowledge_bytes: number;
  disk_free_bytes: number;
  reserve_bytes: number;
};
type Capacity = {
  upload_limits: Record<string, number>;
  total_bytes: number;
  default_personal_bytes: number;
  user_quotas: Record<string, number>;
};
type Operation = {
  id: string;
  actor: string | null;
  action: string;
  path: string;
  details: Record<string, unknown>;
  created_at: string;
};
type Modal =
  | "folder"
  | "markdown"
  | "rename"
  | "copy"
  | "move"
  | "delete"
  | "share"
  | "history"
  | "preview"
  | "capacity"
  | "purge"
  | "purge-all"
  | null;
const GIB = 1024 ** 3;
const TicketModal = dynamic(() => import("@/components/tickets/ticket-modal"), {
  ssr: false,
});
function bytes(n: number) {
  return n >= GIB
    ? `${(n / GIB).toFixed(2)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : n >= 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${n} B`;
}

export default function FileBrowser({
  knowledge = false,
  initialShared = false,
}: {
  knowledge?: boolean;
  initialShared?: boolean;
}) {
  const locale = useLocale();
  const d = useCallback(
    (en: string, zh: string) => (locale === "zh-CN" ? zh : en),
    [locale],
  );
  const { data: session } = useSession();
  const developer = session?.user?.role === "developer";
  const [space, setSpace] = useState<Space>(
    knowledge ? "knowledge" : initialShared ? "shared" : "public",
  );
  const [path, setPath] = useState("");
  const [sharedRoot, setSharedRoot] = useState<Entry | null>(null);
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [archiveTicket, setArchiveTicket] = useState<Ticket | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [editMarkdown, setEditMarkdown] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewType, setPreviewType] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [targetSpace, setTargetSpace] = useState("public");
  const [targetPath, setTargetPath] = useState("");
  const [targetFolders, setTargetFolders] = useState<Entry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [shareUsers, setShareUsers] = useState<string[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [upload, setUpload] = useState<{
    name: string;
    percent: number | null;
    index: number;
    count: number;
  } | null>(null);
  const [conflictName, setConflictName] = useState("");
  const conflictResolve = useRef<((keep: boolean) => void) | null>(null);
  const abortUpload = useRef<AbortController | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const dialogAbort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const readOnly = space === "shared" || space === "attachments";
  const writable = !readOnly && space !== "trash";
  const currentSpace =
    space === "knowledge"
      ? "knowledge"
      : space === "personal"
        ? "personal"
        : "public";
  const titles = {
    public: d("Public space", "公共空间"),
    personal: d("My space", "我的空间"),
    shared: d("Shared with me", "共享给我"),
    knowledge: d("Knowledge base", "知识库"),
    trash: d("Public recycle bin", "公共回收站"),
    attachments: d("My attachments", "我的附件"),
  };
  const refresh = () => setReload((v) => v + 1);
  useEffect(() => {
    const changed = () => setReload((v) => v + 1);
    window.addEventListener("file-storage-changed", changed);
    return () => window.removeEventListener("file-storage-changed", changed);
  }, []);
  const indexLabels: Record<string, string> = {
    ready: d("Indexed", "索引完成"),
    text_only: d("Text search available", "文本可检索，向量待重试"),
    pending: d("Index pending", "等待索引"),
    empty: d("Empty content", "正文为空"),
    draft: d("Index pending", "等待索引"),
  };
  const actionLabels: Record<string, string> = {
    create: d("Created", "创建"),
    edit: d("Edited", "编辑"),
    rename: d("Renamed", "重命名"),
    move: d("Moved", "移动"),
    copy: d("Copied", "复制"),
    trash: d("Moved to recycle bin", "移入回收站"),
    delete: d("Deleted", "删除"),
    restore: d("Restored", "恢复"),
    purge: d("Permanently deleted", "彻底删除"),
    share: d("Sharing changed", "调整共享"),
    external_discovered: d("Imported from server", "发现服务器文件"),
    external_edit: d("Changed on server", "服务器外部修改"),
    external_deleted: d("Removed on server", "服务器外部删除"),
  };
  const changeSpace = (value: Space) => {
    setSpace(value);
    setPath("");
    setPage(1);
    setQuery("");
    setSharedRoot(null);
    setError("");
    setMessage("");
  };

  useEffect(() => {
    if (!knowledge) changeSpace(initialShared ? "shared" : "public");
  }, [initialShared, knowledge]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        if (space === "attachments") {
          const r = await api.get("/api/v1/files/ticket-archive", {
            signal: controller.signal,
            params: { q: query, page, page_size: 50 },
          });
          if (!controller.signal.aborted) {
            setItems(r.data.items);
            setTotal(r.data.total);
          }
        } else if (space === "trash" || (space === "shared" && !sharedRoot)) {
          const r = await api.get<Entry[]>(
            space === "trash" ? "/api/v1/files/trash" : "/api/v1/files/shared",
            {
              signal: controller.signal,
            },
          );
          const filtered = r.data.filter((e) =>
            e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          );
          if (!controller.signal.aborted) {
            setItems(filtered.slice((page - 1) * 50, page * 50));
            setTotal(filtered.length);
          }
        } else {
          const r = await api.get("/api/v1/files/entries", {
            params: {
              space: currentSpace,
              path,
              page,
              q: query,
              shared_id: sharedRoot?.id,
            },
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            setItems(r.data.items);
            setTotal(r.data.total);
          }
        }
        const r = await api.get<Usage>("/api/v1/files/usage", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setUsage(r.data);
      } catch (e) {
        if (!controller.signal.aborted) {
          setItems([]);
          setError(errorMessage(e));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [space, path, sharedRoot, page, query, reload, currentSpace]);
  useEffect(() => {
    return () => {
      abortUpload.current?.abort();
      previewAbort.current?.abort();
      dialogAbort.current?.abort();
      conflictResolve.current?.(false);
    };
  }, []);
  useEffect(() => {
    if (modal !== "copy" && modal !== "move") return;
    const controller = new AbortController();
    setTargetFolders([]);
    void api
      .get("/api/v1/files/entries", {
        params: { space: targetSpace, path: targetPath, page_size: 100 },
        signal: controller.signal,
      })
      .then((r) => {
        if (!controller.signal.aborted)
          setTargetFolders(r.data.items.filter((e: Entry) => e.is_dir));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [modal, targetSpace, targetPath]);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  const close = () => {
    if (busy) return;
    previewAbort.current?.abort();
    dialogAbort.current?.abort();
    setModalLoading(false);
    setModal(null);
    setPreviewUrl("");
    setSelected(null);
    setContent("");
    setEditMarkdown(false);
  };
  const report = (e: unknown) => setError(errorMessage(e));

  async function download(entry: Entry) {
    setBusy(true);
    setError("");
    try {
      await api.head(`/api/v1/files/${entry.id}/download`);
      const anchor = document.createElement("a");
      anchor.href = `/api/files/${entry.id}/download`;
      anchor.download = entry.name;
      anchor.click();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function open(entry: Entry) {
    if (entry.is_dir) {
      if (space === "shared" && !sharedRoot) {
        setSharedRoot(entry);
        setPath("");
      } else {
        setPath(
          space === "shared" && sharedRoot
            ? entry.path.slice(sharedRoot.path.length + 1)
            : entry.path,
        );
      }
      setPage(1);
      setQuery("");
      return;
    }
    setSelected(entry);
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    setModal("preview");
    setModalLoading(true);
    setContent("");
    setPreviewUrl("");
    setPreviewType("");
    setError("");
    setEditMarkdown(false);
    try {
      if (/\.(md|markdown|txt|log|csv|json|xml|sh|ya?ml)$/i.test(entry.name)) {
        const r = await api.get(`/api/v1/files/${entry.id}/content`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setContent(r.data.content);
        setPreviewType(
          /\.(md|markdown)$/i.test(entry.name) &&
            r.data.content.length <= 200000
            ? "markdown"
            : "text",
        );
      } else if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(entry.name)) {
        setPreviewUrl(`/api/files/${entry.id}/download?preview=1`);
        setPreviewType(/\.pdf$/i.test(entry.name) ? "pdf" : "image");
      } else if (/\.(mp4|webm|ogg)$/i.test(entry.name)) {
        setPreviewUrl(`/api/files/${entry.id}/download?preview=1`);
        setPreviewType("video");
      } else setPreviewType("unsupported");
    } catch (e) {
      if (!controller.signal.aborted) report(e);
    } finally {
      if (!controller.signal.aborted) setModalLoading(false);
    }
  }
  async function show(action: Modal, entry?: Entry) {
    dialogAbort.current?.abort();
    const controller = new AbortController();
    dialogAbort.current = controller;
    setModal(action);
    setSelected(entry || null);
    setName(entry?.name || "");
    setContent("");
    setError("");
    setTargetSpace(
      knowledge ? "knowledge" : space === "personal" ? "personal" : "public",
    );
    setTargetPath("");
    if (action === "share" || action === "capacity" || action === "history") {
      setModalLoading(true);
      try {
        if (action === "history" && entry)
          setOperations(
            (
              await api.get(`/api/v1/files/${entry.id}/operations`, {
                signal: controller.signal,
              })
            ).data,
          );
        else {
          setUsers(
            (
              await api.get<User[]>("/api/v1/users/", {
                signal: controller.signal,
              })
            ).data.filter((u) => u.is_active),
          );
          if (action === "share" && entry)
            setShareUsers(
              (
                await api.get(`/api/v1/files/${entry.id}/shares`, {
                  signal: controller.signal,
                })
              ).data,
            );
          if (action === "capacity") {
            const settings = (
              await api.get<Capacity>("/api/v1/files/capacity", {
                signal: controller.signal,
              })
            ).data;
            const rules = (
              await api.get("/api/v1/uploads/policy", {
                signal: controller.signal,
              })
            ).data;
            setCapacity({ ...settings, upload_limits: rules.limits_mb });
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) report(e);
      } finally {
        if (!controller.signal.aborted) setModalLoading(false);
      }
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (modal === "folder")
        await api.post("/api/v1/files/folders", {
          space: currentSpace,
          parent: path,
          name,
          conflict: "keep",
        });
      else if (modal === "markdown")
        await api.post("/api/v1/files/markdown", {
          space: currentSpace,
          parent: path,
          name,
          content,
          conflict: "keep",
        });
      else if (modal === "rename" && selected)
        await api.patch(`/api/v1/files/${selected.id}`, { name });
      else if ((modal === "copy" || modal === "move") && selected)
        await api.post(
          `/api/v1/files/${selected.id}/transfer`,
          {
            space: targetSpace,
            parent: targetPath,
            copy: modal === "copy",
            conflict: "keep",
          },
          { timeout: 600000 },
        );
      else if (modal === "delete" && selected)
        await api.delete(`/api/v1/files/${selected.id}`);
      else if (modal === "purge" && selected)
        await api.delete(`/api/v1/files/trash/${selected.id}`);
      else if (modal === "purge-all") await api.delete("/api/v1/files/trash");
      else if (modal === "share" && selected)
        await api.put(`/api/v1/files/${selected.id}/shares`, {
          user_ids: shareUsers,
        });
      else if (modal === "capacity" && capacity)
        await api.put("/api/v1/files/capacity", capacity);
      else if (modal === "preview" && selected && editMarkdown)
        await api.put(`/api/v1/files/${selected.id}/content`, { content });
      setModal(null);
      setPreviewUrl("");
      setMessage(d("Saved", "操作完成"));
      refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function restore(entry: Entry) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/v1/files/trash/${entry.id}/restore`);
      refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    setError("");
    try {
      const r = await api.post(
        "/api/v1/files/knowledge/sync",
        {},
        { timeout: 600000 },
      );
      setMessage(
        `${d("Queued for indexing", "已提交索引")}: ${r.data.indexed}${r.data.errors.length ? ` · ${r.data.errors.join("; ")}` : ""}`,
      );
      refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function uploadFiles(files: FileList | null) {
    if (!files || upload) return;
    const controller = new AbortController();
    abortUpload.current = controller;
    const destination = currentSpace,
      directory = path;
    setError("");
    setMessage("");
    let queued = 0;
    try {
      for (const [index, file] of Array.from(files).entries()) {
        if (controller.signal.aborted) break;
        setUpload({
          name: file.name,
          percent: null,
          index: index + 1,
          count: files.length,
        });
        let conflict: "skip" | "keep" = "skip";
        const existing = await api.get("/api/v1/files/exists", {
          params: { space: destination, parent: directory, name: file.name },
          signal: controller.signal,
        });
        if (existing.data.exists) {
          setConflictName(file.name);
          const keep = await new Promise<boolean>((resolve) => {
            conflictResolve.current = resolve;
          });
          conflictResolve.current = null;
          setConflictName("");
          if (!keep) continue;
          conflict = "keep";
        }
        if (controller.signal.aborted) break;
        enqueueUpload(file, {
          purpose: knowledge ? "knowledge" : "storage",
          space: destination === "public" ? "public" : "personal",
          parent: directory,
          conflict,
        });
        queued++;
      }
      setMessage(d("Added to upload queue", "已加入上传队列") + ": " + queued);
    } catch (e) {
      if (!controller.signal.aborted) report(e);
    } finally {
      setUpload(null);
      abortUpload.current = null;
      if (input.current) input.current.value = "";
    }
  }
  const modalTitles = {
    folder: d("New folder", "新建文件夹"),
    markdown: d("New Markdown", "新建 Markdown"),
    rename: d("Rename", "重命名"),
    copy: d("Copy to", "复制到"),
    move: d("Move to", "移动到"),
    delete: d("Delete", "删除"),
    share: d("Share with users", "共享给成员"),
    history: d("Operation history", "操作记录"),
    preview: selected?.name || d("Preview", "预览"),
    capacity: d("Storage capacity", "容量设置"),
    purge: d("Permanently delete", "彻底删除"),
    "purge-all": d("Empty public recycle bin", "清空公共回收站"),
  };

  return (
    <div
      className={`flex flex-col ${knowledge ? "min-h-[calc(100dvh-3rem)]" : "min-h-[100dvh]"}`}
    >
      {!knowledge && <TopNav title={d("Storage", "存储空间")} />}
      <div
        role="toolbar"
        aria-label={d("File toolbar", "文件工具栏")}
        className="flex min-h-14 flex-wrap items-center gap-2 border-b px-4 py-2"
      >
        {writable && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!!upload || busy}
              onClick={() => void show("folder")}
            >
              <FolderPlus />
              {d("New folder", "新建文件夹")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!upload || busy}
              onClick={() => input.current?.click()}
            >
              <Upload />
              {d("Upload", "上传")}
            </Button>
            {knowledge && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void show("markdown")}
              >
                <Pencil />
                {d("New Markdown", "新建 Markdown")}
              </Button>
            )}
          </>
        )}
        <input
          ref={input}
          type="file"
          multiple
          accept={knowledge ? ".md,.markdown" : undefined}
          className="hidden"
          onChange={(e) => void uploadFiles(e.target.files)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title={d("Refresh", "刷新")}
          aria-label={d("Refresh", "刷新")}
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
        {knowledge && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void sync()}
          >
            {d("Scan and sync", "扫描并同步")}
          </Button>
        )}
        {developer && !knowledge && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void show("capacity")}
          >
            <Settings2 />
            {d("Capacity", "容量设置")}
          </Button>
        )}
        {developer && space === "trash" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !total}
            onClick={() => void show("purge-all")}
          >
            <Trash2 />
            {d("Empty recycle bin", "清空回收站")}
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {!knowledge && (
          <aside className="flex shrink-0 flex-wrap gap-1 border-b p-3 md:w-44 md:flex-col md:border-r md:border-b-0">
            {(
              [
                "public",
                "personal",
                "attachments",
                "shared",
                "trash",
              ] as Space[]
            ).map((value) => (
              <Button
                key={value}
                variant={space === value ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => changeSpace(value)}
              >
                {value === "shared" ? (
                  <Share2 />
                ) : value === "trash" ? (
                  <Trash2 />
                ) : (
                  <Folder />
                )}
                {titles[value]}
              </Button>
            ))}
            {usage && (
              <div className="text-muted-foreground mt-3 space-y-2 px-2 text-xs md:mt-auto">
                <p>
                  {d("Total pool", "总池")}: {bytes(usage.used_bytes)} /{" "}
                  {bytes(usage.total_bytes)}
                </p>
                <div className="bg-muted h-1 overflow-hidden rounded">
                  <div
                    className="bg-primary h-full"
                    style={{
                      width: `${Math.min(100, usage.total_bytes ? (usage.used_bytes / usage.total_bytes) * 100 : 100)}%`,
                    }}
                  />
                </div>
                <p>
                  {d("My space", "个人")}: {bytes(usage.personal_bytes)} /{" "}
                  {bytes(usage.personal_limit)}
                </p>
                <p>
                  {d("Disk free", "磁盘可用")}: {bytes(usage.disk_free_bytes)}
                </p>
                {!!usage.reserved_bytes && (
                  <p>
                    {d("Reserved for uploads", "上传预留")}:{" "}
                    {bytes(usage.reserved_bytes)} · {d("Mine", "本人")}:{" "}
                    {bytes(usage.personal_reserved_bytes)}
                  </p>
                )}
              </div>
            )}
          </aside>
        )}
        <main className="min-w-0 flex-1 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {(path || sharedRoot) && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={d("Parent folder", "返回上级")}
                onClick={() => {
                  if (!path) setSharedRoot(null);
                  else setPath(path.split("/").slice(0, -1).join("/"));
                  setPage(1);
                  setQuery("");
                }}
              >
                <ArrowLeft />
              </Button>
            )}
            <nav
              aria-label={d("Folder path", "文件夹路径")}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPath("");
                  setSharedRoot(null);
                  setPage(1);
                }}
              >
                {titles[space]}
              </Button>
              {sharedRoot && <span>/ {sharedRoot.name}</span>}
              {path
                .split("/")
                .filter(Boolean)
                .map((part, i) => (
                  <span key={i} className="flex items-center">
                    /
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPath(
                          path
                            .split("/")
                            .slice(0, i + 1)
                            .join("/"),
                        );
                        setPage(1);
                      }}
                    >
                      {part}
                    </Button>
                  </span>
                ))}
            </nav>
            <Input
              className="w-52"
              placeholder={
                space === "attachments"
                  ? d("Search filename or ticket", "搜索文件名或工单")
                  : d("Search this folder", "搜索当前文件夹")
              }
              aria-label={d("Search files", "搜索文件")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-muted-foreground text-sm">
              {message}
            </p>
          )}
          {upload && (
            <div className="rounded-lg border p-3 text-sm" role="status">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                <span className="min-w-0 flex-1 truncate">
                  {upload.index}/{upload.count} · {upload.name} ·{" "}
                  {upload.percent ?? "…"}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    abortUpload.current?.abort();
                    conflictResolve.current?.(false);
                  }}
                >
                  {d("Cancel", "取消")}
                </Button>
              </div>
              <div
                role="progressbar"
                aria-label={d("Upload progress", "上传进度")}
                aria-valuenow={upload.percent ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                className="bg-muted mt-2 h-1 rounded"
              >
                <div
                  className="bg-primary h-full rounded"
                  style={{ width: `${upload.percent ?? 30}%` }}
                />
              </div>
            </div>
          )}
          {space === "trash" && (
            <p className="text-muted-foreground text-xs">
              {d(
                "Deleted public files still count toward the pool. Only developers can restore or permanently delete them.",
                "公共回收站仍占用总池容量，仅开发者可以恢复或彻底删除。",
              )}
            </p>
          )}
          {knowledge && usage && (
            <p className="text-muted-foreground text-xs">
              {d(
                "Markdown only · AI indexes all knowledge content · Storage measured separately",
                "仅支持 Markdown · AI 可检索全部知识库内容 · 容量独立统计",
              )}
              : {bytes(usage.knowledge_bytes)}
            </p>
          )}
          <div className="overflow-hidden rounded-lg border">
            <Table aria-label={d("Files", "文件列表")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{d("Name", "名称")}</TableHead>
                  {space === "attachments" && (
                    <TableHead>{d("Ticket", "所属工单")}</TableHead>
                  )}
                  <TableHead>{d("Size", "大小")}</TableHead>
                  <TableHead>{d("Creator", "创建人")}</TableHead>
                  <TableHead>
                    {space === "attachments"
                      ? d("Uploaded", "上传时间")
                      : d("Modified", "修改时间")}
                  </TableHead>
                  <TableHead className="text-right">
                    {d("Actions", "操作")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={space === "attachments" ? 6 : 5}
                      className="h-32 text-center"
                    >
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : items.length ? (
                  items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <button
                          className="flex max-w-80 items-center gap-2 text-left hover:underline"
                          onClick={() => {
                            if (space !== "trash") void open(entry);
                          }}
                          disabled={space === "trash"}
                          title={entry.path}
                        >
                          {entry.is_dir ? (
                            <Folder className="text-muted-foreground size-5 shrink-0" />
                          ) : entry.thumbnail_size ? (
                            <Image
                              unoptimized
                              alt=""
                              width={32}
                              height={32}
                              className="size-8 shrink-0 rounded object-cover"
                              src={`/api/files/${entry.id}/download?thumbnail=1`}
                            />
                          ) : (
                            <File className="text-muted-foreground size-5 shrink-0" />
                          )}
                          <span className="truncate">{entry.name}</span>
                        </button>
                        {entry.index_status && (
                          <p className="text-muted-foreground mt-1 text-xs">
                            {indexLabels[entry.index_status] ||
                              entry.index_status}
                          </p>
                        )}
                        {space === "trash" && (
                          <p className="text-muted-foreground mt-1 text-xs">
                            {entry.path}
                          </p>
                        )}
                      </TableCell>
                      {space === "attachments" && (
                        <TableCell
                          className="max-w-64 truncate"
                          title={entry.ticket_name}
                        >
                          {entry.ticket_name}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap">
                        {entry.is_dir ? "—" : bytes(entry.size)}
                      </TableCell>
                      <TableCell>
                        {entry.creator?.name ||
                          d("Server import", "服务器导入")}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(
                          (space === "attachments"
                            ? entry.created_at
                            : entry.deleted_at) || entry.updated_at,
                        ).toLocaleString(locale)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {space === "attachments" && entry.ticket_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void api
                                  .get<Ticket>(
                                    `/api/v1/tickets/${entry.ticket_id}`,
                                  )
                                  .then((r) => setArchiveTicket(r.data))
                                  .catch(report)
                              }
                            >
                              {d("Open ticket", "打开工单")}
                            </Button>
                          )}
                          {space === "trash" && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={d("History", "操作记录")}
                              aria-label={`${d("History", "操作记录")} ${entry.name}`}
                              onClick={() => void show("history", entry)}
                            >
                              <History />
                            </Button>
                          )}
                          {space === "trash" ? (
                            developer && (
                              <>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  title={d("Restore", "恢复")}
                                  aria-label={`${d("Restore", "恢复")} ${entry.name}`}
                                  disabled={busy}
                                  onClick={() => void restore(entry)}
                                >
                                  <Undo2 />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  title={d("Permanently delete", "彻底删除")}
                                  aria-label={`${d("Permanently delete", "彻底删除")} ${entry.name}`}
                                  onClick={() => void show("purge", entry)}
                                >
                                  <Trash2 />
                                </Button>
                              </>
                            )
                          ) : (
                            <>
                              {!entry.is_dir && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={busy}
                                  title={d("Download", "下载")}
                                  aria-label={`${d("Download", "下载")} ${entry.name}`}
                                  onClick={() => void download(entry)}
                                >
                                  <Download />
                                </Button>
                              )}
                              {space !== "attachments" && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title={d("Copy", "复制")}
                                  aria-label={`${d("Copy", "复制")} ${entry.name}`}
                                  onClick={() => void show("copy", entry)}
                                >
                                  <Copy />
                                </Button>
                              )}
                              {writable && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    title={d("Move", "移动")}
                                    aria-label={`${d("Move", "移动")} ${entry.name}`}
                                    onClick={() => void show("move", entry)}
                                  >
                                    <Move />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    title={d("Rename", "重命名")}
                                    aria-label={`${d("Rename", "重命名")} ${entry.name}`}
                                    onClick={() => void show("rename", entry)}
                                  >
                                    <Pencil />
                                  </Button>
                                </>
                              )}
                              {space === "personal" && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title={d("Share", "共享")}
                                  aria-label={`${d("Share", "共享")} ${entry.name}`}
                                  onClick={() => void show("share", entry)}
                                >
                                  <Share2 />
                                </Button>
                              )}
                              {space !== "attachments" && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title={d("History", "操作记录")}
                                  aria-label={`${d("History", "操作记录")} ${entry.name}`}
                                  onClick={() => void show("history", entry)}
                                >
                                  <History />
                                </Button>
                              )}
                              {writable && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title={d("Delete", "删除")}
                                  aria-label={`${d("Delete", "删除")} ${entry.name}`}
                                  onClick={() => void show("delete", entry)}
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={space === "attachments" ? 6 : 5}
                      className="text-muted-foreground h-32 text-center"
                    >
                      {d("No files", "暂无文件")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>
              {total} · {page}/{Math.max(1, Math.ceil(total / 50))}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {d("Previous", "上一页")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page * 50 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                {d("Next", "下一页")}
              </Button>
            </div>
          </div>
        </main>
      </div>
      {archiveTicket && (
        <TicketModal
          ticket={archiveTicket}
          onClose={() => setArchiveTicket(null)}
          onSuccess={refresh}
        />
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          className={
            modal === "preview" || modal === "markdown"
              ? "flex max-h-[90dvh] w-[min(1100px,95vw)] max-w-none flex-col"
              : "max-h-[85dvh] overflow-auto"
          }
        >
          <DialogHeader>
            <DialogTitle>{modal ? modalTitles[modal] : ""}</DialogTitle>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {modalLoading ? (
            <Loader2 className="mx-auto my-10 size-6 animate-spin" />
          ) : (
            <>
              {(modal === "folder" ||
                modal === "rename" ||
                modal === "markdown") && (
                <Input
                  aria-label={d("Name", "名称")}
                  value={name}
                  placeholder={d("Name", "名称")}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
              {modal === "markdown" && (
                <textarea
                  className="min-h-72 w-full rounded-lg border bg-transparent p-3 font-mono text-sm"
                  aria-label={d("Markdown content", "Markdown 正文")}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              )}
              {(modal === "copy" || modal === "move") && (
                <div className="space-y-3">
                  <select
                    className="bg-background w-full rounded-lg border p-2 text-sm"
                    aria-label={d("Destination space", "目标空间")}
                    value={targetSpace}
                    onChange={(e) => {
                      setTargetSpace(e.target.value);
                      setTargetPath("");
                    }}
                  >
                    {knowledge ? (
                      <option value="knowledge">{titles.knowledge}</option>
                    ) : (
                      <>
                        <option value="public">{titles.public}</option>
                        {!(
                          modal === "move" && selected?.space === "public"
                        ) && (
                          <option value="personal">{titles.personal}</option>
                        )}
                      </>
                    )}
                  </select>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={d("Parent destination", "目标上级目录")}
                      disabled={!targetPath}
                      onClick={() =>
                        setTargetPath(
                          targetPath.split("/").slice(0, -1).join("/"),
                        )
                      }
                    >
                      <ArrowLeft />
                    </Button>
                    <span className="text-sm break-all">/{targetPath}</span>
                  </div>
                  <div className="max-h-60 overflow-auto rounded border p-2">
                    {targetFolders.map((f) => (
                      <Button
                        key={f.id}
                        className="w-full justify-start"
                        variant="ghost"
                        onClick={() => setTargetPath(f.path)}
                      >
                        <Folder />
                        {f.name}
                      </Button>
                    ))}
                    {!targetFolders.length && (
                      <p className="text-muted-foreground p-3 text-xs">
                        {d("No subfolders", "没有子文件夹")}
                      </p>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {d(
                      "Name conflicts keep both files. Shared copies become independent files and use your quota.",
                      "重名时加括号数字保留两者；复制共享文件会生成独立副本并占用目标空间容量。",
                    )}
                  </p>
                </div>
              )}
              {(modal === "delete" ||
                modal === "purge" ||
                modal === "purge-all") && (
                <p className="text-sm">
                  {modal === "delete" && space === "public"
                    ? d(
                        "Move to the public recycle bin? Storage is released only after permanent deletion.",
                        "移入公共回收站？彻底清除前仍占用总池容量。",
                      )
                    : modal === "purge-all"
                      ? d(
                          "Permanently delete every item in the public recycle bin? This cannot be undone.",
                          "永久清除公共回收站内的全部项目？此操作无法恢复。",
                        )
                      : d(
                          "Permanently delete this item and all its contents? This cannot be undone.",
                          "永久删除此项目及其全部内容？此操作无法恢复。",
                        )}
                </p>
              )}
              {modal === "share" && (
                <div className="max-h-80 space-y-2 overflow-auto">
                  {users
                    .filter((u) => u.id !== session?.user?.id)
                    .map((u) => (
                      <label
                        key={u.id}
                        className="hover:bg-muted flex items-center gap-2 rounded p-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={shareUsers.includes(u.id)}
                          onChange={(e) =>
                            setShareUsers((old) =>
                              e.target.checked
                                ? [...old, u.id]
                                : old.filter((id) => id !== u.id),
                            )
                          }
                        />
                        {u.name}
                      </label>
                    ))}
                  <p className="text-muted-foreground text-xs">
                    {d(
                      "View and download only. Folder access includes current and future descendants.",
                      "仅授予浏览、下载。文件夹授权包含现有及后续新增的子项目。",
                    )}
                  </p>
                </div>
              )}
              {modal === "history" && (
                <div className="max-h-96 space-y-3 overflow-auto text-xs">
                  <p>
                    {d("Creator", "创建人")}:{" "}
                    {selected?.creator?.name ||
                      d("Server import", "服务器导入")}
                  </p>
                  {!!selected?.modifiers.length && (
                    <p>
                      {d("Modified by", "修改人")}:{" "}
                      {selected.modifiers.map((u) => u.name).join(", ")}
                    </p>
                  )}
                  {selected?.sha256 && (
                    <p className="font-mono break-all">
                      SHA-256: {selected.sha256}
                    </p>
                  )}
                  {operations.map((o) => (
                    <div key={o.id} className="space-y-1 border-b pb-2">
                      <p>
                        {o.actor || d("External change", "服务器外部变更")} ·{" "}
                        {actionLabels[o.action] ||
                          d("File operation", "文件操作")}
                      </p>
                      <p className="text-muted-foreground">
                        {new Date(o.created_at).toLocaleString(locale)} ·{" "}
                        {o.path}
                      </p>
                    </div>
                  ))}
                  {!operations.length &&
                    d("No operations recorded", "暂无操作记录")}
                </div>
              )}
              {modal === "preview" && (
                <>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !selected}
                      onClick={() => {
                        if (selected) void download(selected);
                      }}
                    >
                      <Download />
                      {d("Download", "下载")}
                    </Button>
                    {previewType === "markdown" && writable && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditMarkdown((v) => !v)}
                      >
                        <Pencil />
                        {editMarkdown
                          ? d("Preview", "预览")
                          : d("Edit", "编辑")}
                      </Button>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {editMarkdown ? (
                      <textarea
                        className="h-[55dvh] w-full rounded border bg-transparent p-3 font-mono text-sm"
                        aria-label={d("Markdown content", "Markdown 正文")}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                      />
                    ) : previewType === "markdown" ? (
                      <div className="prose dark:prose-invert min-h-56 max-w-none p-3">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {content}
                        </ReactMarkdown>
                      </div>
                    ) : previewType === "text" ? (
                      <CodeBlock>
                        <CodeBlockContent
                          className="max-h-[60dvh]"
                          lineNumbers={
                            content.length < 500000 &&
                            content.split("\n").length <= 10000
                          }
                        >
                          {content}
                        </CodeBlockContent>
                      </CodeBlock>
                    ) : previewType === "pdf" ? (
                      <iframe
                        title={selected?.name}
                        src={previewUrl}
                        className="h-[65dvh] w-full"
                      />
                    ) : previewType === "video" ? (
                      <video
                        controls
                        preload="metadata"
                        src={previewUrl}
                        className="max-h-[65dvh] w-full"
                      />
                    ) : previewType === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={selected?.name}
                        src={previewUrl}
                        className="mx-auto max-h-[65dvh] object-contain"
                      />
                    ) : (
                      <p className="text-muted-foreground py-12 text-center">
                        {d(
                          "Download this file to view it.",
                          "此格式请下载后查看。",
                        )}
                      </p>
                    )}
                  </div>
                </>
              )}
              {modal === "capacity" && capacity && (
                <div className="space-y-4 text-sm">
                  <p className="font-medium">
                    {d("Upload limits (MiB)", "单文件上传上限（MiB）")}
                  </p>
                  {Object.entries(capacity.upload_limits || {}).map(
                    ([key, value]) => (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>
                          {(
                            {
                              storage: d("Storage", "普通文件"),
                              knowledge: d("Knowledge", "知识库"),
                              log: d("Device logs", "设备日志"),
                              image: d("Images", "图片"),
                              attachment: d("Ticket attachments", "工单附件"),
                              video: d("Videos", "视频"),
                            } as Record<string, string>
                          )[key] || key}
                        </span>
                        <Input
                          className="w-28"
                          type="number"
                          min={1}
                          max={2048}
                          value={value}
                          onChange={(e) =>
                            setCapacity({
                              ...capacity,
                              upload_limits: {
                                ...capacity.upload_limits,
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                  <label className="block space-y-1">
                    <span>{d("Total pool (GB)", "总池容量（GB）")}</span>
                    <Input
                      type="number"
                      min={0}
                      value={capacity.total_bytes / GIB}
                      onChange={(e) =>
                        setCapacity({
                          ...capacity,
                          total_bytes: Math.round(Number(e.target.value) * GIB),
                        })
                      }
                    />
                  </label>
                  <label className="block space-y-1">
                    <span>
                      {d("Default personal limit (GB)", "默认个人上限（GB）")}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      value={capacity.default_personal_bytes / GIB}
                      onChange={(e) =>
                        setCapacity({
                          ...capacity,
                          default_personal_bytes: Math.round(
                            Number(e.target.value) * GIB,
                          ),
                        })
                      }
                    />
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {d(
                      "Limits do not reserve disk space. Existing files remain when a limit is reduced. 1 GB here is 1024³ bytes.",
                      "配额不预占磁盘，调低后保留已有文件。此处 1GB 按 1024³ 字节计算。",
                    )}
                  </p>
                  {users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>{u.name}</span>
                      <Input
                        className="w-28"
                        type="number"
                        min={0}
                        placeholder={String(
                          capacity.default_personal_bytes / GIB,
                        )}
                        value={
                          capacity.user_quotas[u.id] === undefined
                            ? ""
                            : capacity.user_quotas[u.id] / GIB
                        }
                        onChange={(e) => {
                          const quotas = { ...capacity.user_quotas };
                          if (e.target.value === "") delete quotas[u.id];
                          else
                            quotas[u.id] = Math.round(
                              Number(e.target.value) * GIB,
                            );
                          setCapacity({ ...capacity, user_quotas: quotas });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="mt-3 flex shrink-0 justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={close}>
              {d("Close", "关闭")}
            </Button>
            {modal !== "history" && (modal !== "preview" || editMarkdown) && (
              <Button
                disabled={
                  busy ||
                  modalLoading ||
                  ((modal === "folder" ||
                    modal === "rename" ||
                    modal === "markdown") &&
                    !name.trim())
                }
                onClick={() => void submit()}
              >
                {busy && <Loader2 className="animate-spin" />}
                {d("Confirm", "确定")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!conflictName}
        onOpenChange={(value) => {
          if (!value) {
            conflictResolve.current?.(false);
            setConflictName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{d("Name already exists", "名称已存在")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm break-all">{conflictName}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => conflictResolve.current?.(false)}
            >
              {d("Skip", "跳过")}
            </Button>
            <Button onClick={() => conflictResolve.current?.(true)}>
              {d("Keep both", "保留两者")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
