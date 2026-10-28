"use client";

import { Download, Eye, Loader2, RefreshCw, Search } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type PaginationState,
  columnVisibilityFeature,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/base/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/base/code-block";
import { Input } from "@/components/ui/base/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/base/table";
import { FloatingWindow } from "@/components/workbench/floating-window";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useConsoleLogUpload } from "./console-log-upload";
import { downloadDeviceBlob } from "./device-tools";

type LogEntry = {
  id: string;
  filename: string;
  file_size: number;
  line_count: number;
  created_at: string;
  uploader_name: string;
};
const historyFeatures = tableFeatures({
  rowPaginationFeature,
  columnVisibilityFeature,
});
function size(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function ConsoleLogHistory({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const locale = useLocale();
  const d = useCallback(
    (en: string, zh: string) => (locale === "zh-CN" ? zh : en),
    [locale],
  );
  const { revision } = useConsoleLogUpload();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [viewing, setViewing] = useState<LogEntry | null>(null);
  const [content, setContent] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setViewing(null);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api
      .get<{ items: LogEntry[]; total: number }>("/api/v1/debug/logs", {
        params: {
          device_type: "serial",
          page: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
          q: query,
        },
        signal: controller.signal,
      })
      .then((response) => {
        if (!controller.signal.aborted) {
          setLogs(response.data.items);
          setTotal(response.data.total);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            errorMessage(e, d("Failed to load logs", "历史日志加载失败")),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    open,
    revision,
    refresh,
    d,
    pagination.pageIndex,
    pagination.pageSize,
    query,
  ]);
  useEffect(() => {
    setContent("");
    setPreviewError("");
    if (!viewing) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    void api
      .get<string>(`/api/v1/debug/logs/${viewing.id}/download`, {
        responseType: "text",
        transformResponse: [(data) => data],
        signal: controller.signal,
      })
      .then((response) => {
        if (!controller.signal.aborted) setContent(response.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setPreviewError(
            errorMessage(
              e,
              d("Failed to load log content", "日志内容加载失败"),
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [viewing, d]);
  const download = useCallback(
    async (entry: LogEntry) => {
      setDownloading(entry.id);
      setDownloadError("");
      try {
        const response = await api.get<Blob>(
          `/api/v1/debug/logs/${entry.id}/download`,
          { responseType: "blob" },
        );
        downloadDeviceBlob(response.data, entry.filename);
      } catch (e) {
        setDownloadError(errorMessage(e, d("Download failed", "日志下载失败")));
      } finally {
        setDownloading(null);
      }
    },
    [d],
  );
  const columns = useMemo<ColumnDef<typeof historyFeatures, LogEntry>[]>(
    () => [
      {
        accessorKey: "filename",
        header: d("Filename", "文件名"),
        cell: ({ row }) => (
          <span
            className="block max-w-80 truncate"
            title={row.original.filename}
          >
            {row.original.filename}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: d("Uploaded", "上传时间"),
        cell: ({ row }) =>
          new Date(row.original.created_at).toLocaleString(locale),
      },
      {
        accessorKey: "file_size",
        header: d("Size", "大小"),
        cell: ({ row }) => size(row.original.file_size),
      },
      { accessorKey: "line_count", header: d("Lines", "行数") },
      { accessorKey: "uploader_name", header: d("Uploader", "上传者") },
      {
        id: "actions",
        header: d("Actions", "操作"),
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              title={d("Preview", "预览")}
              aria-label={`${d("Preview", "预览")} ${row.original.filename}`}
              onClick={() => {
                setPreviewLoading(true);
                setContent("");
                setPreviewError("");
                setViewing({ ...row.original });
              }}
            >
              <Eye />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={downloading !== null}
              title={d("Download", "下载")}
              aria-label={`${d("Download", "下载")} ${row.original.filename}`}
              onClick={() => void download(row.original)}
            >
              {downloading === row.original.id ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
            </Button>
          </div>
        ),
      },
    ],
    [d, locale, download, downloading],
  );
  useEffect(() => {
    setPagination((old) => {
      const pageIndex = Math.min(
        old.pageIndex,
        Math.max(0, Math.ceil(total / old.pageSize) - 1),
      );
      return pageIndex === old.pageIndex ? old : { ...old, pageIndex };
    });
  }, [total]);
  const table = useTable({
    features: historyFeatures,
    data: logs,
    columns,
    rowCount: total,
    manualPagination: true,
    autoResetPageIndex: false,
    state: { pagination },
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
  });
  const numbered =
    content.length < 500000 && content.split("\n").length <= 10000;
  return (
    <>
      <FloatingWindow
        open={open}
        onClose={onClose}
        title={d("Log history", "历史日志")}
        closeLabel={d("Close log history", "关闭历史日志")}
        initialSize={{ width: 1120, height: 700 }}
        containScroll
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <Search
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
              placeholder={d("Search filenames", "搜索文件名")}
              aria-label={d("Search log filenames", "搜索日志文件名")}
              className="max-w-sm"
            />
            <Button
              variant="outline"
              size="icon"
              className="ml-auto"
              title={d("Refresh", "刷新")}
              aria-label={d("Refresh log history", "刷新历史日志")}
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
          {(error || downloadError) && (
            <p role="alert" className="text-destructive text-sm">
              {error || downloadError}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <Table aria-label={d("Uploaded logs", "已上传日志")}>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={
                          header.column.id === "actions"
                            ? "bg-popover sticky right-0 z-10 text-right"
                            : undefined
                        }
                      >
                        <table.FlexRender header={header} />
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-28 text-center"
                    >
                      <Loader2
                        className="mx-auto size-5 animate-spin"
                        aria-label={d("Loading", "正在加载")}
                      />
                    </TableCell>
                  </TableRow>
                ) : table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={
                            cell.column.id === "actions"
                              ? "bg-popover sticky right-0"
                              : undefined
                          }
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-muted-foreground h-28 text-center"
                    >
                      {d("No matching logs", "暂无匹配的日志")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              {d("Logs", "日志数")}: {total} · {pagination.pageIndex + 1} /{" "}
              {Math.max(1, table.getPageCount())}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                {d("Previous", "上一页")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                {d("Next", "下一页")}
              </Button>
            </div>
          </div>
        </div>
      </FloatingWindow>
      <FloatingWindow
        open={!!viewing && open}
        onClose={() => setViewing(null)}
        title={viewing?.filename ?? d("Log preview", "日志预览")}
        closeLabel={d("Close log preview", "关闭日志预览")}
        initialSize={{ width: 1040, height: 700 }}
        containScroll
      >
        {previewLoading ? (
          <div className="grid h-full place-items-center">
            <Loader2
              className="size-6 animate-spin"
              aria-label={d("Loading log content", "正在加载日志内容")}
            />
          </div>
        ) : previewError ? (
          <p role="alert" className="text-destructive">
            {previewError}
          </p>
        ) : (
          <CodeBlock className="h-full" size="sm">
            <CodeBlockHeader>
              <CodeBlockTitle>{viewing?.filename}</CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton
                  value={content}
                  title={d("Copy log", "复制日志")}
                  aria-label={d("Copy log", "复制日志")}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!viewing || downloading !== null}
                  title={d("Download", "下载")}
                  aria-label={d("Download previewed log", "下载当前预览日志")}
                  onClick={() => {
                    if (viewing) void download(viewing);
                  }}
                >
                  <Download />
                </Button>
              </CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent
              className="flex-1"
              lineNumbers={numbered}
              aria-label={d("Log content", "日志内容")}
            >
              {content}
            </CodeBlockContent>
            {downloadError && (
              <CodeBlockFooter>
                <p role="alert" className="text-destructive text-xs">
                  {downloadError}
                </p>
              </CodeBlockFooter>
            )}
          </CodeBlock>
        )}
      </FloatingWindow>
    </>
  );
}
