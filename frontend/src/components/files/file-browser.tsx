"use client";

import { isAxiosError } from "axios";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  Loader2,
  Move,
  PanelLeft,
  Pencil,
  RefreshCw,
  Search,
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
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createColumnHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import Container from "@/components/container";
import StorageWorkspace from "@/components/files/storage-workspace";
import { TopNav } from "@/components/nav";
import PageToolbar from "@/components/page-toolbar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/base/breadcrumb";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import { CodeBlock, CodeBlockContent } from "@/components/ui/base/code-block";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/base/context-menu";
import {
  Dialog,
  DialogContent,
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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/base/hover-card";
import { Input } from "@/components/ui/base/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/base/input-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/base/item";
import { Label } from "@/components/ui/base/label";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/base/menubar";
import { NativeSelect } from "@/components/ui/base/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import { Progress } from "@/components/ui/base/progress";
import { Skeleton } from "@/components/ui/base/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/base/table";
import { Textarea } from "@/components/ui/base/textarea";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { enqueueUpload } from "@/lib/upload-manager";
import type { Ticket } from "@/types/ticket";
import workspaceStyles from "./storage-workspace.module.css";

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
const fileTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSelectionFeature,
});
const fileColumn = createColumnHelper<typeof fileTableFeatures, Entry>();
const fileColumns = fileColumn.columns([
  fileColumn.accessor("name", { header: "Name" }),
  fileColumn.accessor("size", { header: "Size" }),
  fileColumn.accessor("creator", { header: "Creator" }),
  fileColumn.accessor("updated_at", { header: "Modified" }),
]);
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
  | "usage"
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
}: {
  knowledge?: boolean;
}) {
  const locale = useLocale();
  const d = useCallback(
    (en: string, zh: string) => (locale === "zh-CN" ? zh : en),
    [locale],
  );
  const { data: session } = useSession();
  const developer = session?.user?.role === "developer";
  const [space, setSpace] = useState<Space>(knowledge ? "knowledge" : "public");
  const [path, setPath] = useState("");
  const [sharedRoot, setSharedRoot] = useState<Entry | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [batchEntries, setBatchEntries] = useState<Entry[]>([]);
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "size" | "updated_at">("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const columnDrag = useRef<{
    key: string;
    next: string;
    start: number;
    width: number;
    widths: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [archiveTicket, setArchiveTicket] = useState<Ticket | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [name, setName] = useState("");
  const [fileConflict, setFileConflict] = useState(false);
  const [latestFile, setLatestFile] = useState<{
    content: string;
    revision: string;
  } | null>(null);
  const [contentRevision, setContentRevision] = useState("");
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
  const conflictResolve = useRef<
    ((choice: "skip" | "keep" | "replace") => void) | null
  >(null);
  const [allowReplace, setAllowReplace] = useState(false);
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
  useEffect(() => {
    setCheckedIds([]);
  }, [space, path, sharedRoot?.id, query, page, reload, sort, direction]);
  const rowSelection = Object.fromEntries(
    checkedIds.map((id) => [id, true as const]),
  );
  const table = useTable({
    features: fileTableFeatures,
    columns: fileColumns,
    data: items,
    getRowId: (entry) => entry.id,
    rowCount: total,
    manualPagination: true,
    autoResetPageIndex: false,
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      setCheckedIds(Object.keys(next).filter((id) => next[id]));
    },
    onPaginationChange: (updater) => {
      const previous = { pageIndex: page - 1, pageSize: 50 };
      const next = typeof updater === "function" ? updater(previous) : updater;
      setPage(next.pageIndex + 1);
    },
    state: { rowSelection, pagination: { pageIndex: page - 1, pageSize: 50 } },
  });
  const checkedEntries = table
    .getSelectedRowModel()
    .rows.map((row) => row.original);
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
    if (!knowledge) changeSpace("public");
  }, [knowledge]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        if (space === "attachments") {
          const r = await api.get("/api/v1/files/ticket-archive", {
            signal: controller.signal,
            params: { q: query, page, page_size: 50, sort, direction },
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
          filtered.sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            const delta =
              sort === "name"
                ? a.name.localeCompare(b.name, undefined, {
                    numeric: false,
                    sensitivity: "base",
                  })
                : sort === "size"
                  ? a.size - b.size
                  : new Date(a.deleted_at || a.updated_at).getTime() -
                    new Date(b.deleted_at || b.updated_at).getTime();
            return (
              (direction === "desc" ? -delta : delta) ||
              a.id.localeCompare(b.id)
            );
          });
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
              sort,
              direction,
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
  }, [
    space,
    path,
    sharedRoot,
    page,
    query,
    reload,
    currentSpace,
    sort,
    direction,
  ]);
  useEffect(() => {
    return () => {
      abortUpload.current?.abort();
      previewAbort.current?.abort();
      dialogAbort.current?.abort();
      conflictResolve.current?.("skip");
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
    setModalOpen(false);
  };
  const clearClosedModal = () => {
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
    setModalOpen(true);
    setModalLoading(true);
    setContent("");
    setFileConflict(false);
    setLatestFile(null);
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
        setContentRevision(r.data.revision);
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
  async function show(action: Modal, entry?: Entry, targets?: Entry[]) {
    setBatchEntries(targets ?? (entry ? [entry] : []));
    dialogAbort.current?.abort();
    const controller = new AbortController();
    dialogAbort.current = controller;
    setModal(action);
    setModalOpen(!!action);
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
    if (modal === "preview" && fileConflict) return;
    setBusy(true);
    setError("");
    const completed: string[] = [];
    const removed: string[] = [];
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
      else if ((modal === "copy" || modal === "move") && batchEntries.length) {
        for (const selected of batchEntries) {
          let choice: "skip" | "keep" | "replace" = "keep";
          const existing = await api.get("/api/v1/files/exists", {
            params: {
              space: targetSpace,
              parent: targetPath,
              name: selected.name,
            },
          });
          if (existing.data.exists) {
            setAllowReplace(modal === "copy" && !selected.is_dir);
            setConflictName(selected.name);
            choice = await new Promise<"skip" | "keep" | "replace">(
              (resolve) => {
                conflictResolve.current = resolve;
              },
            );
            conflictResolve.current = null;
            setConflictName("");
            setAllowReplace(false);
          }
          if (choice !== "skip") {
            await api.post(
              `/api/v1/files/${selected.id}/transfer`,
              {
                space: targetSpace,
                parent: targetPath,
                copy: modal === "copy",
                conflict: choice,
              },
              { timeout: 600000 },
            );
            if (modal === "move") removed.push(selected.id);
          }
          completed.push(selected.id);
        }
      } else if (
        (modal === "delete" || modal === "purge") &&
        batchEntries.length
      ) {
        for (const entry of batchEntries) {
          await api.delete(
            modal === "purge"
              ? `/api/v1/files/trash/${entry.id}`
              : `/api/v1/files/${entry.id}`,
          );
          completed.push(entry.id);
          removed.push(entry.id);
        }
      } else if (modal === "purge-all") await api.delete("/api/v1/files/trash");
      else if (modal === "share" && selected)
        await api.put(`/api/v1/files/${selected.id}/shares`, {
          user_ids: shareUsers,
        });
      else if (modal === "capacity" && capacity)
        await api.put("/api/v1/files/capacity", capacity);
      else if (modal === "preview" && selected && editMarkdown)
        await api.put(`/api/v1/files/${selected.id}/content`, {
          content,
          revision: contentRevision,
        });
      setModalOpen(false);
      setMessage(d("Saved", "操作完成"));
      refresh();
    } catch (e) {
      if (completed.length) {
        setBatchEntries((entries) =>
          entries.filter((entry) => !completed.includes(entry.id)),
        );
        setCheckedIds((ids) => ids.filter((id) => !completed.includes(id)));
        setItems((entries) =>
          entries.filter((entry) => !removed.includes(entry.id)),
        );
        setTotal((total) => Math.max(0, total - removed.length));
        setMessage(
          d(
            "Some items completed; retry will process only the remaining items.",
            "部分项目已完成；重试仅处理剩余项目。",
          ),
        );
      }
      if (modal === "preview" && isAxiosError(e) && e.response?.status === 409)
        setFileConflict(true);
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
          const keep = await new Promise<"skip" | "keep" | "replace">(
            (resolve) => {
              conflictResolve.current = resolve;
            },
          );
          conflictResolve.current = null;
          setConflictName("");
          if (keep === "skip") continue;
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
    usage: d("Storage usage", "容量详情"),
    capacity: d("Storage capacity", "容量设置"),
    purge: d("Permanently delete", "彻底删除"),
    "purge-all": d("Empty public recycle bin", "清空公共回收站"),
  };

  const spaces: Space[] = [
    "public",
    "personal",
    "attachments",
    "shared",
    "trash",
  ];
  const used = usage
    ? space === "personal"
      ? usage.personal_bytes
      : usage.used_bytes
    : 0;
  const limit = usage
    ? space === "personal"
      ? usage.personal_limit
      : usage.total_bytes
    : 0;
  const percent =
    limit > 0
      ? Math.min(100, Math.max(0, (used / limit) * 100))
      : used > 0
        ? 100
        : 0;
  const capacityLabel =
    space === "personal" ? d("Personal", "个人空间") : d("Storage", "存储容量");
  const capacityItem = (
    <Item className="w-full p-0">
      <ItemContent className="gap-2">
        <ItemTitle>
          <HardDrive className="size-4 shrink-0" />
          {capacityLabel}
        </ItemTitle>
        {usage ? (
          <>
            <Progress value={percent} aria-label={capacityLabel} />
            <ItemDescription className="tabular-nums">
              {bytes(used)} / {bytes(limit)}
            </ItemDescription>
            <Button
              variant="link"
              size="sm"
              className="h-auto justify-start p-0 text-xs"
              onClick={() => void show("usage")}
            >
              {d("Storage usage", "容量详情")}
            </Button>
          </>
        ) : (
          <>
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </>
        )}
      </ItemContent>
    </Item>
  );
  // Context follows shadcn's Hover Card + Progress composition. A click also
  // opens details so keyboard and touch users do not depend on hover.
  const capacitySummary = !knowledge && (
    <>
      <div className={workspaceStyles.capacityFull}>{capacityItem}</div>
      <div className={workspaceStyles.capacityCompact}>
        <HoverCard>
          <HoverCardTrigger
            delay={10}
            closeDelay={100}
            render={
              <Button
                variant="outline"
                size="sm"
                className="w-full px-1 tabular-nums"
                aria-label={d("Storage usage", "容量详情")}
                onClick={() => void show("usage")}
              />
            }
          >
            {usage ? (
              `${Math.round(percent)}%`
            ) : (
              <Skeleton className="h-4 w-6" />
            )}
          </HoverCardTrigger>
          <HoverCardContent side="right">{capacityItem}</HoverCardContent>
        </HoverCard>
      </div>
    </>
  );
  const navigation = (
    <>
      <nav
        aria-label={d("Storage spaces", "存储空间分类")}
        className="space-y-1"
      >
        {spaces.map((value) => (
          <Button
            key={value}
            variant={space === value ? "secondary" : "ghost"}
            aria-current={space === value ? "page" : undefined}
            className="w-full min-w-0 justify-start"
            aria-label={titles[value]}
            title={titles[value]}
            onClick={() => changeSpace(value)}
          >
            {value === "shared" ? (
              <Share2 />
            ) : value === "trash" ? (
              <Trash2 />
            ) : (
              <Folder />
            )}
            <span className={`${workspaceStyles.fullLabel} truncate`}>
              {titles[value]}
            </span>
            <span className={workspaceStyles.compactLabel} aria-hidden="true">
              {Array.from(titles[value])[0]}...
            </span>
          </Button>
        ))}
      </nav>
      <div className="mt-auto border-t pt-3">{capacitySummary}</div>
    </>
  );
  const mobileNavigation = (
    <div className="flex min-w-0 items-center justify-between gap-2 border-b pb-3">
      <Button
        variant="outline"
        onClick={() => setSpacePickerOpen(true)}
        aria-label={d("Choose storage space", "选择存储空间")}
      >
        <PanelLeft />
        {titles[space]}
      </Button>
      <Dialog open={spacePickerOpen} onOpenChange={setSpacePickerOpen}>
        <DialogContent className="top-auto bottom-4 max-h-[80dvh] -translate-y-0 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{d("Storage spaces", "存储空间分类")}</DialogTitle>
          </DialogHeader>
          <nav
            aria-label={d("Switch storage space", "切换存储空间")}
            className="grid gap-2"
          >
            {spaces.map((value) => (
              <Button
                key={value}
                className="h-11 justify-start"
                variant={space === value ? "secondary" : "ghost"}
                aria-current={space === value ? "page" : undefined}
                onClick={() => {
                  changeSpace(value);
                  setSpacePickerOpen(false);
                }}
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
          </nav>
        </DialogContent>
      </Dialog>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={d("Storage usage", "容量详情")}
            />
          }
        >
          <HardDrive />
          {usage ? `${Math.round(percent)}%` : "…"}
        </PopoverTrigger>
        <PopoverContent align="end">{capacityItem}</PopoverContent>
      </Popover>
    </div>
  );
  function entryActions(targets: Entry[], Item: typeof MenubarItem) {
    const one = targets.length === 1 ? targets[0] : null;
    const disabled = busy || loading || !targets.length;
    return (
      <>
        <Item
          disabled={disabled || !one || space === "trash"}
          onClick={() => {
            if (one) void open(one);
          }}
        >
          <Folder />
          {d("Open", "打开")}
        </Item>
        <Item
          disabled={
            disabled ||
            targets.some((entry) => entry.is_dir) ||
            space === "trash"
          }
          onClick={async () => {
            for (const entry of targets) await download(entry);
          }}
        >
          <Download />
          {d("Download", "下载")}
        </Item>
        {space !== "attachments" && space !== "trash" && (
          <Item
            disabled={disabled}
            onClick={() => void show("copy", targets[0], targets)}
          >
            <Copy />
            {d("Copy to", "复制到")}
          </Item>
        )}
        {writable && (
          <>
            <Item
              disabled={disabled}
              onClick={() => void show("move", targets[0], targets)}
            >
              <Move />
              {d("Move to", "移动到")}
            </Item>
            <Item
              disabled={disabled || !one}
              onClick={() => {
                if (one) void show("rename", one);
              }}
            >
              <Pencil />
              {d("Rename", "重命名")}
            </Item>
          </>
        )}
        {space === "personal" && (
          <Item
            disabled={disabled || !one}
            onClick={() => {
              if (one) void show("share", one);
            }}
          >
            <Share2 />
            {d("Share", "共享")}
          </Item>
        )}
        {one?.ticket_id && space === "attachments" && (
          <Item
            disabled={disabled}
            onClick={() =>
              void api
                .get<Ticket>(`/api/v1/tickets/${one.ticket_id}`)
                .then((r) => setArchiveTicket(r.data))
                .catch(report)
            }
          >
            {d("Open ticket", "打开工单")}
          </Item>
        )}
        {space !== "attachments" && (
          <Item
            disabled={disabled || !one}
            onClick={() => {
              if (one) void show("history", one);
            }}
          >
            <History />
            {d("History", "操作记录")}
          </Item>
        )}
        {writable && (
          <Item
            variant="destructive"
            disabled={disabled}
            onClick={() => void show("delete", targets[0], targets)}
          >
            <Trash2 />
            {d("Delete", "删除")}
          </Item>
        )}
        {space === "trash" && developer && (
          <>
            <Item
              disabled={disabled || !one}
              onClick={() => {
                if (one) void restore(one);
              }}
            >
              <Undo2 />
              {d("Restore", "恢复")}
            </Item>
            <Item
              variant="destructive"
              disabled={disabled}
              onClick={() => void show("purge", targets[0], targets)}
            >
              <Trash2 />
              {d("Permanently delete", "彻底删除")}
            </Item>
          </>
        )}
      </>
    );
  }
  const creationActions = (Item: typeof MenubarItem) => (
    <>
      {writable && (
        <>
          <Item
            disabled={!!upload || busy}
            onClick={() => input.current?.click()}
          >
            <Upload />
            {d("Upload", "上传")}
          </Item>
          <Item disabled={!!upload || busy} onClick={() => void show("folder")}>
            <FolderPlus />
            {d("New folder", "新建文件夹")}
          </Item>
          {knowledge && (
            <Item disabled={busy} onClick={() => void show("markdown")}>
              <Pencil />
              {d("New Markdown", "新建 Markdown")}
            </Item>
          )}
        </>
      )}
      <Item disabled={loading || busy} onClick={refresh}>
        <RefreshCw />
        {d("Refresh", "刷新")}
      </Item>
    </>
  );
  const toolbar = (
    <PageToolbar label={d("File toolbar", "文件工具栏")}>
      <Menubar aria-label={d("File commands", "文件命令")}>
        <MenubarMenu>
          <MenubarTrigger>{d("File", "文件")}</MenubarTrigger>
          <MenubarContent className="w-44">
            {creationActions(MenubarItem)}
            {knowledge && (
              <MenubarItem disabled={busy} onClick={() => void sync()}>
                {d("Scan and sync", "扫描并同步")}
              </MenubarItem>
            )}
            {developer && space === "trash" && (
              <>
                <MenubarSeparator />
                <MenubarItem
                  variant="destructive"
                  disabled={busy || !total}
                  onClick={() => void show("purge-all")}
                >
                  <Trash2 />
                  {d("Empty recycle bin", "清空回收站")}
                </MenubarItem>
              </>
            )}
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>{d("Edit", "编辑")}</MenubarTrigger>
          <MenubarContent className="w-44">
            {entryActions(checkedEntries, MenubarItem)}
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>{d("Select", "选择")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem
              disabled={loading || busy || !items.length}
              onClick={() => table.toggleAllPageRowsSelected(true)}
            >
              {d("Select this page", "全选当前页")}
            </MenubarItem>
            <MenubarItem
              disabled={!checkedIds.length}
              onClick={() => table.resetRowSelection()}
            >
              {d("Clear selection", "取消选择")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <Button
        variant="ghost"
        size="icon"
        aria-label={d("Refresh", "刷新")}
        disabled={loading || busy}
        onClick={refresh}
      >
        <RefreshCw className={loading ? "animate-spin" : ""} />
      </Button>
      <span role="status" className="text-muted-foreground text-xs">
        {checkedEntries.length
          ? `${d("Selected", "已选")} ${checkedEntries.length}`
          : ""}
      </span>
      <div className="ml-auto w-full min-w-0 flex-1 basis-full sm:max-w-80 sm:min-w-40 sm:basis-0">
        <InputGroup>
          <InputGroupInput
            aria-label={d("Search files", "搜索文件")}
            placeholder={
              space === "attachments"
                ? d("Search filename or ticket", "搜索文件名或工单")
                : d("Search this folder", "搜索当前文件夹")
            }
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
      <input
        ref={input}
        type="file"
        multiple
        accept={knowledge ? ".md,.markdown" : undefined}
        className="hidden"
        onChange={(e) => void uploadFiles(e.target.files)}
      />
    </PageToolbar>
  );
  const columns =
    space === "attachments"
      ? [
          { key: "name", label: d("Name", "名称"), ratio: 34 },
          { key: "ticket", label: d("Ticket", "所属工单"), ratio: 20 },
          { key: "size", label: d("Size", "大小"), ratio: 12 },
          { key: "creator", label: d("Creator", "创建人"), ratio: 14 },
          { key: "updated_at", label: d("Uploaded", "上传时间"), ratio: 20 },
        ]
      : [
          { key: "name", label: d("Name", "名称"), ratio: 43 },
          { key: "size", label: d("Size", "大小"), ratio: 13 },
          { key: "creator", label: d("Creator", "创建人"), ratio: 17 },
          { key: "updated_at", label: d("Modified", "修改时间"), ratio: 27 },
        ];
  const widthPrefix = space === "attachments" ? "archive-" : "files-";
  const widths = Object.fromEntries(
    columns.map((column) => [
      column.key,
      columnWidths[widthPrefix + column.key] ?? column.ratio,
    ]),
  );
  function adjustColumns(
    key: string,
    next: string,
    delta: number,
    start = widths,
  ) {
    const minimum = (id: string) =>
      id === "name" ? 24 : id === "updated_at" ? 18 : 10;
    const amount = Math.max(
      minimum(key) - start[key],
      Math.min(start[next] - minimum(next), delta),
    );
    setColumnWidths((previous) => ({
      ...previous,
      [widthPrefix + key]: start[key] + amount,
      [widthPrefix + next]: start[next] - amount,
    }));
  }
  const contentView = (
    <div className="space-y-4">
      <div className="flex h-8 min-w-0 items-center gap-3" data-storage-path>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={d("Parent folder", "返回上级")}
              disabled={!path && !sharedRoot}
              onClick={() => {
                if (!path) setSharedRoot(null);
                else setPath(path.split("/").slice(0, -1).join("/"));
                setPage(1);
                setQuery("");
              }}
            >
              <ArrowLeft />
            </Button>
          }
          <Breadcrumb
            aria-label={d("Folder path", "文件夹路径")}
            className="min-w-0 overflow-x-auto whitespace-nowrap"
          >
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem>
                {!path && !sharedRoot ? (
                  <BreadcrumbPage>{titles[space]}</BreadcrumbPage>
                ) : (
                  <Button
                    variant="link"
                    className="text-muted-foreground h-auto p-0"
                    onClick={() => {
                      setPath("");
                      setSharedRoot(null);
                      setPage(1);
                      setQuery("");
                    }}
                  >
                    {titles[space]}
                  </Button>
                )}
              </BreadcrumbItem>
              {sharedRoot && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {!path ? (
                      <BreadcrumbPage>{sharedRoot.name}</BreadcrumbPage>
                    ) : (
                      <Button
                        variant="link"
                        className="text-muted-foreground h-auto max-w-64 truncate p-0"
                        onClick={() => {
                          setPath("");
                          setPage(1);
                          setQuery("");
                        }}
                      >
                        {sharedRoot.name}
                      </Button>
                    )}
                  </BreadcrumbItem>
                </>
              )}
              {path
                .split("/")
                .filter(Boolean)
                .map((part, i, parts) => (
                  <Fragment key={parts.slice(0, i + 1).join("/")}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="max-w-full">
                      {i === parts.length - 1 ? (
                        <BreadcrumbPage className="truncate" title={part}>
                          {part}
                        </BreadcrumbPage>
                      ) : (
                        <Button
                          variant="link"
                          className="text-muted-foreground h-auto max-w-64 truncate p-0"
                          title={part}
                          onClick={() => {
                            setPath(parts.slice(0, i + 1).join("/"));
                            setPage(1);
                            setQuery("");
                          }}
                        >
                          {part}
                        </Button>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
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
                conflictResolve.current?.("skip");
              }}
            >
              {d("Cancel", "取消")}
            </Button>
          </div>
          <Progress
            className="mt-2"
            value={upload.percent}
            aria-label={d("Upload progress", "上传进度")}
          />
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
      <ContextMenu>
        <ContextMenuTrigger
          render={<div className="overflow-hidden rounded-lg border" />}
        >
          <Table
            aria-label={d("Files", "文件列表")}
            aria-busy={loading}
            className="table-fixed"
            style={{ minWidth: space === "attachments" ? 900 : 700 }}
          >
            <colgroup>
              <col style={{ width: 40 }} />
              {columns.map((column) => (
                <col
                  key={column.key}
                  style={{
                    width: `${widths[column.key]}%`,
                  }}
                />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={d("Select this page", "全选当前页")}
                    disabled={busy || loading || !items.length}
                    checked={!!items.length && table.getIsAllPageRowsSelected()}
                    indeterminate={
                      table.getIsSomePageRowsSelected() &&
                      !table.getIsAllPageRowsSelected()
                    }
                    onCheckedChange={(checked) =>
                      table.toggleAllPageRowsSelected(checked)
                    }
                  />
                </TableHead>
                {columns.map((column, i) => {
                  const sortable =
                    column.key === "name" ||
                    column.key === "size" ||
                    column.key === "updated_at";
                  const next = columns[i + 1]?.key;
                  return (
                    <TableHead
                      key={column.key}
                      className="relative pr-4"
                      aria-sort={
                        sortable
                          ? sort === column.key
                            ? direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                          : undefined
                      }
                    >
                      {sortable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-8 max-w-full gap-1 px-2"
                          onClick={() => {
                            setDirection(
                              sort === column.key && direction === "asc"
                                ? "desc"
                                : "asc",
                            );
                            setSort(column.key as typeof sort);
                            setPage(1);
                          }}
                        >
                          <span className="truncate">{column.label}</span>
                          {sort === column.key ? (
                            direction === "asc" ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            )
                          ) : (
                            <ArrowUpDown className="text-muted-foreground size-3" />
                          )}
                        </Button>
                      ) : (
                        <span className="block truncate">{column.label}</span>
                      )}
                      {next && (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`${d("Resize", "调整列宽")} ${column.label}`}
                          aria-valuenow={Math.round(widths[column.key])}
                          aria-valuemin={column.key === "name" ? 24 : 10}
                          aria-valuemax={90}
                          tabIndex={0}
                          className="hover:bg-primary/30 focus-visible:bg-primary/30 absolute top-2 right-0 bottom-2 w-2 cursor-col-resize touch-none border-r select-none"
                          onDoubleClick={() => setColumnWidths({})}
                          onKeyDown={(event) => {
                            if (
                              event.key === "ArrowLeft" ||
                              event.key === "ArrowRight"
                            ) {
                              event.preventDefault();
                              adjustColumns(
                                column.key,
                                next,
                                event.key === "ArrowRight" ? 2 : -2,
                              );
                            }
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            columnDrag.current = {
                              key: column.key,
                              next,
                              start: event.clientX,
                              width:
                                (event.currentTarget
                                  .closest("table")
                                  ?.getBoundingClientRect().width ?? 740) - 40,
                              widths,
                            };
                          }}
                          onPointerMove={(event) => {
                            const drag = columnDrag.current;
                            if (
                              drag &&
                              event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              adjustColumns(
                                drag.key,
                                drag.next,
                                ((event.clientX - drag.start) / drag.width) *
                                  100,
                                drag.widths,
                              );
                          }}
                          onPointerUp={() => {
                            columnDrag.current = null;
                          }}
                          onPointerCancel={() => {
                            columnDrag.current = null;
                          }}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: items.length || 4 }, (_, index) => (
                  <TableRow key={index} aria-hidden="true">
                    <TableCell
                      className={items[index]?.thumbnail_size ? "h-12" : "h-9"}
                    >
                      <Skeleton className="size-4" />
                    </TableCell>
                    {columns.map((column) => (
                      <TableCell key={column.key}>
                        <Skeleton
                          className={
                            column.key === "name" ? "h-5 w-3/4" : "h-4 w-2/3"
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length ? (
                table.getRowModel().rows.map((row) => {
                  const entry = row.original;
                  return (
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger
                        render={
                          <TableRow
                            tabIndex={0}
                            data-state={
                              checkedIds.includes(entry.id)
                                ? "selected"
                                : undefined
                            }
                            className="focus-visible:ring-ring data-[state=selected]:bg-muted cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
                            onClick={() => {
                              if (space !== "trash" && !busy) void open(entry);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.target === event.currentTarget &&
                                event.key === "Enter" &&
                                space !== "trash" &&
                                !busy
                              ) {
                                event.preventDefault();
                                void open(entry);
                              }
                            }}
                            onContextMenu={(event) => {
                              event.stopPropagation();
                              if (!checkedIds.includes(entry.id))
                                setCheckedIds([entry.id]);
                            }}
                          />
                        }
                      >
                        <TableCell
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            aria-label={`${d("Select", "选择")} ${entry.name}`}
                            disabled={busy || loading}
                            checked={row.getIsSelected()}
                            onCheckedChange={(checked) =>
                              row.toggleSelected(checked)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex min-w-0 items-center gap-2"
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
                          </div>
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
                        <TableCell
                          className="truncate"
                          title={
                            entry.creator?.name ||
                            d("Server import", "服务器导入")
                          }
                        >
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
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        {entryActions(
                          checkedIds.includes(entry.id)
                            ? checkedEntries
                            : [entry],
                          ContextMenuItem,
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={space === "attachments" ? 6 : 5}
                    className="text-muted-foreground h-32 text-center"
                  >
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Folder />
                        </EmptyMedia>
                        <EmptyTitle>
                          {query
                            ? d("No matching files", "未找到匹配文件")
                            : d("No files", "暂无文件")}
                        </EmptyTitle>
                        <EmptyDescription>
                          {query
                            ? d(
                                "Try a different search.",
                                "试试其他搜索关键词。",
                              )
                            : writable
                              ? d(
                                  "Upload a file or create a folder to get started.",
                                  "上传文件或新建文件夹，开始整理内容。",
                                )
                              : d(
                                  "Files will appear here when available.",
                                  "有可访问的文件时会显示在这里。",
                                )}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {creationActions(ContextMenuItem)}
        </ContextMenuContent>
      </ContextMenu>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground" role="status">
          {table.getSelectedRowModel().rows.length} of {table.getRowCount()}{" "}
          row(s) selected.
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {page} / {table.getPageCount() || 1}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            {d("Previous", "上一页")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            {d("Next", "下一页")}
          </Button>
        </div>
      </div>
    </div>
  );
  return (
    <div
      data-storage-page
      className={`flex flex-col ${knowledge ? "min-h-[calc(100dvh-4rem)]" : "min-h-[100dvh]"}`}
    >
      {!knowledge && <TopNav title={d("Storage", "存储空间")} />}
      {toolbar}
      <Container className="min-w-0 flex-1 pb-6">
        {knowledge ? (
          <div className="pt-4">{contentView}</div>
        ) : (
          <StorageWorkspace
            navigation={navigation}
            mobileNavigation={mobileNavigation}
            resizeLabel={d("Resize space navigation", "调整空间导航宽度")}
          >
            {contentView}
          </StorageWorkspace>
        )}
      </Container>
      {archiveTicket && (
        <TicketModal
          ticket={archiveTicket}
          onClose={() => setArchiveTicket(null)}
          onSuccess={refresh}
        />
      )}
      <Dialog
        open={modalOpen}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        onOpenChangeComplete={(value) => {
          // Base UI keeps the popup mounted during its exit animation. Keep
          // its type and contents intact until the popup has finished closing.
          if (!value && !modalOpen) clearClosedModal();
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
          {batchEntries.length > 1 && (
            <p className="text-muted-foreground text-sm">
              {d("Selected items", "选中项目")}: {batchEntries.length}
            </p>
          )}
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
                <Textarea
                  className="min-h-72 w-full rounded-lg border bg-transparent p-3 font-mono text-sm"
                  aria-label={d("File content", "文件正文")}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              )}
              {(modal === "copy" || modal === "move") && (
                <div className="space-y-3">
                  <NativeSelect
                    className="w-full"
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
                  </NativeSelect>
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
                      "For name conflicts, choose Replace, Keep both or Skip. Shared copies are independent and use your quota.",
                      "复制文件重名时可选择替换、保留两者或跳过；复制共享文件会生成独立副本并占用目标空间容量。",
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
                      <Label
                        key={u.id}
                        className="hover:bg-muted flex items-center gap-2 rounded p-2 text-sm"
                      >
                        <Checkbox
                          checked={shareUsers.includes(u.id)}
                          onCheckedChange={(checked) =>
                            setShareUsers((old) =>
                              checked === true
                                ? [...old, u.id]
                                : old.filter((id) => id !== u.id),
                            )
                          }
                        />
                        {u.name}
                      </Label>
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
                    {(previewType === "markdown" ||
                      (selected && /\.(json|sh)$/i.test(selected.name))) &&
                      writable && (
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
                    {fileConflict && editMarkdown && (
                      <div className="space-y-2 border p-2 text-xs">
                        <p>
                          {d(
                            "Your draft is retained. Load the latest file to compare before saving.",
                            "草稿已保留，请载入最新文件并比较后再保存。",
                          )}
                        </p>
                        {!latestFile ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                              if (!selected) return;
                              setBusy(true);
                              try {
                                const { data } = await api.get(
                                  `/api/v1/files/${selected.id}/content`,
                                );
                                setLatestFile(data);
                              } catch (e) {
                                report(e);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {d("Load latest version", "载入最新版本")}
                          </Button>
                        ) : (
                          <>
                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                              {latestFile.content}
                            </pre>
                            <Button
                              size="sm"
                              onClick={() => {
                                setContentRevision(latestFile.revision);
                                setLatestFile(null);
                                setFileConflict(false);
                                setError("");
                              }}
                            >
                              {d("Keep my draft", "保留我的草稿")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setContent(latestFile.content);
                                setContentRevision(latestFile.revision);
                                setLatestFile(null);
                                setFileConflict(false);
                                setError("");
                              }}
                            >
                              {d("Use latest version", "使用最新版本")}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                    {editMarkdown ? (
                      <Textarea
                        className="h-[55dvh] w-full rounded border bg-transparent p-3 font-mono text-sm"
                        disabled={busy}
                        aria-label={d("File content", "文件正文")}
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
              {modal === "usage" && usage && (
                <div className="space-y-5 text-sm">
                  {[
                    {
                      label: d("Total pool", "总池"),
                      used: usage.used_bytes,
                      total: usage.total_bytes,
                    },
                    {
                      label: d("My space", "个人空间"),
                      used: usage.personal_bytes,
                      total: usage.personal_limit,
                    },
                  ].map((item) => (
                    <div key={item.label} className="space-y-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>{item.label}</span>
                        <span className="text-muted-foreground">
                          {bytes(item.used)} / {bytes(item.total)}
                        </span>
                      </div>
                      <Progress
                        value={
                          item.total
                            ? Math.min(100, (item.used / item.total) * 100)
                            : 0
                        }
                        aria-label={item.label}
                      />
                    </div>
                  ))}
                  <dl className="space-y-2">
                    {[
                      [d("Disk free", "磁盘可用"), usage.disk_free_bytes],
                      [
                        d("Reserved for uploads", "上传预留"),
                        usage.reserved_bytes,
                      ],
                      [
                        d("My upload reservations", "本人上传预留"),
                        usage.personal_reserved_bytes,
                      ],
                      [
                        d("Knowledge storage", "知识库容量"),
                        usage.knowledge_bytes,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={String(label)}
                        className="flex flex-wrap justify-between gap-2"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd>{bytes(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
                  {developer && (
                    <Button
                      variant="outline"
                      onClick={() => void show("capacity")}
                    >
                      <Settings2 />
                      {d("Capacity settings", "容量设置")}
                    </Button>
                  )}
                </div>
              )}
              {modal === "capacity" && capacity && (
                <div className="space-y-4 text-sm">
                  <p className="font-medium">
                    {d("Upload limits (MiB)", "单文件上传上限（MiB）")}
                  </p>
                  {Object.entries(capacity.upload_limits || {}).map(
                    ([key, value]) => (
                      <Label
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
                      </Label>
                    ),
                  )}
                  <Label className="block space-y-1">
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
                  </Label>
                  <Label className="block space-y-1">
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
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {d(
                      "Limits do not reserve disk space. Existing files remain when a limit is reduced. 1 GB here is 1024³ bytes.",
                      "配额不预占磁盘，调低后保留已有文件。此处 1GB 按 1024³ 字节计算。",
                    )}
                  </p>
                  {users.map((u) => (
                    <Label
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
                    </Label>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="mt-3 flex shrink-0 justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={close}>
              {d("Close", "关闭")}
            </Button>
            {modal &&
              modal !== "usage" &&
              modal !== "history" &&
              (modal !== "preview" || editMarkdown) && (
                <Button
                  disabled={
                    busy ||
                    modalLoading ||
                    (modal === "preview" && fileConflict) ||
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
            conflictResolve.current?.("skip");
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
              onClick={() => conflictResolve.current?.("skip")}
            >
              {d("Skip", "跳过")}
            </Button>
            {allowReplace && (
              <Button onClick={() => conflictResolve.current?.("replace")}>
                {d("Replace", "替换")}
              </Button>
            )}
            <Button onClick={() => conflictResolve.current?.("keep")}>
              {d("Keep both", "保留两者")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
