"use client";

import {
  Download,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import { Input } from "@/components/ui/base/input";
import { useFeedback } from "@/components/ui/feedback-provider";
import { useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { uploadManager } from "@/lib/upload-manager";

interface LogEntry {
  id: string;
  filename: string;
  file_size: number;
  line_count: number;
  description: string | null;
  created_at: string;
  uploader_name: string;
}

interface Props {
  deviceType: "adb" | "serial";
  lines: string[]; // 当前终端内容
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LogPanel({ deviceType, lines }: Props) {
  const { confirm, notify } = useFeedback();

  const locale = useLocale();

  const t = useUiTranslations();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [description, setDesc] = useState("");
  const [viewing, setViewing] = useState<LogEntry | null>(null);
  const [viewContent, setViewContent] = useState("");
  const [viewLoading, setViewLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get("/api/v1/debug/logs", {
        params: { device_type: deviceType },
      });
      setLogs(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [deviceType]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  async function handleUpload() {
    if (lines.length === 0) {
      void notify(t("ui.noLogContent"));
      return;
    }
    setUploading(true);
    try {
      const text = lines.join("\n");
      const file = new File([text], `${deviceType}_${Date.now()}.txt`, {
        type: "text/plain;charset=utf-8",
      });
      await uploadManager.enqueue(file, {
        purpose: "log",
        device_type: deviceType,
        description: description.trim(),
        conflict: "keep",
      }).promise;
      setDesc("");
      loadLogs();
    } catch (e: unknown) {
      void notify(errorMessage(e, t("ui.uploadFailed")));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm(t("ui.deleteThisLogRecord")))) return;
    await apiClient.delete(`/api/v1/debug/logs/${id}`);
    loadLogs();
  }

  async function handleView(log: LogEntry) {
    setViewing(log);
    setViewLoading(true);
    setViewContent("");
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/debug/logs/${log.id}/download`;
      const r = await apiClient.get(url, {
        responseType: "text",
        transformResponse: [(value) => value],
      });
      setViewContent(
        typeof r.data === "string" ? r.data : JSON.stringify(r.data),
      );
    } catch {
      setViewContent(t("ui.loadFailed"));
    } finally {
      setViewLoading(false);
    }
  }

  async function handleDownload(log: LogEntry) {
    try {
      const r = await apiClient.get(`/api/v1/debug/logs/${log.id}/download`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(r.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = log.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      void notify(errorMessage(e));
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：保存当前日志 */}
      <div className="border-border flex-shrink-0 space-y-2 border-b px-3 py-2.5">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t("ui.saveLogsToServer")}
        </p>
        <Input
          value={description}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t("ui.descriptionOptional")}
          className="border-border bg-muted/30 focus:ring-primary/30 w-full rounded-lg border px-2 py-1.5 text-xs focus:ring-1 focus:outline-none"
        />
        <Button
          variant="outline"
          onClick={handleUpload}
          disabled={uploading || lines.length === 0}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <FileText size={12} />
          )}
          {uploading
            ? t("ui.uploading")
            : t("dynamic.saveOther", { p0: lines.length })}
        </Button>
      </div>

      {/* 历史日志列表 */}
      <div className="border-border flex flex-shrink-0 items-center justify-between border-b px-3 py-2">
        <p className="text-muted-foreground text-xs font-semibold">
          {t("ui.logHistory")}
        </p>
        <Button
          variant="outline"
          onClick={loadLogs}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={16} className="text-muted-foreground animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-xs">
            {t("ui.noLogHistory")}
          </p>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="border-border hover:bg-muted/20 border-b px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{log.filename}</p>
                  <p className="text-muted-foreground text-xs">
                    {log.uploader_name} · {fmtSize(log.file_size)} ·{" "}
                    {log.line_count} {t("ui.lines")}
                  </p>
                  {log.description && (
                    <p className="text-muted-foreground truncate text-xs">
                      {log.description}
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {new Date(log.created_at).toLocaleString(locale)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    onClick={() => handleView(log)}
                    title={t("ui.viewOnline")}
                    className="text-muted-foreground hover:text-primary p-1 transition-colors"
                  >
                    <Eye size={12} />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleDownload(log)}
                    title={t("ui.download")}
                    className="text-muted-foreground hover:text-primary p-1 transition-colors"
                  >
                    <Download size={12} />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleDelete(log.id)}
                    title={t("ui.delete")}
                    className="text-muted-foreground p-1 transition-colors hover:text-red-500"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 在线浏览弹窗 */}
      {viewing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setViewing(null);
          }}
        >
          <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-4xl">
            <DialogHeader className="flex-row items-center justify-between pr-8">
              <div>
                <DialogTitle>{viewing.filename}</DialogTitle>
                <p className="text-muted-foreground text-xs">
                  {viewing.uploader_name} · {fmtSize(viewing.file_size)} ·{" "}
                  {viewing.line_count} {t("ui.lines")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleDownload(viewing)}
                  className="border-border hover:bg-muted/50 text-muted-foreground flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                >
                  <Download size={12} /> {t("ui.download")}
                </Button>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto rounded-b-2xl bg-slate-950 p-4 font-mono text-xs leading-5">
              {viewLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                </div>
              ) : (
                viewContent.split("\n").map((line, i) => {
                  let color = "text-slate-300";
                  if (/ [EF]\//.test(line) || / E /.test(line))
                    color = "text-red-400";
                  else if (/ W\//.test(line) || / W /.test(line))
                    color = "text-yellow-400";
                  else if (/ I\//.test(line) || / I /.test(line))
                    color = "text-green-400";
                  else if (/ D\//.test(line) || / D /.test(line))
                    color = "text-blue-400";
                  return (
                    <div
                      key={i}
                      className={`${color} break-all whitespace-pre-wrap`}
                    >
                      <span className="mr-2 text-slate-600 select-none">
                        {i + 1}
                      </span>
                      {line}
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
