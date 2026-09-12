"use client";

import { useEffect, useState } from "react";
import { Download, Trash2, RefreshCw, Loader2, FileText, Eye, X } from "lucide-react";
import apiClient from "@/lib/api";

interface LogEntry {
  id:            string;
  filename:      string;
  file_size:     number;
  line_count:    number;
  description:   string | null;
  created_at:    string;
  uploader_name: string;
}

interface Props {
  deviceType: "adb" | "serial";
  lines:      string[];             // 当前终端内容
  onClose:    () => void;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LogPanel({ deviceType, lines, onClose }: Props) {
  const [logs,        setLogs]       = useState<LogEntry[]>([]);
  const [loading,     setLoading]    = useState(true);
  const [uploading,   setUploading]  = useState(false);
  const [description, setDesc]       = useState("");
  const [viewing,     setViewing]    = useState<LogEntry | null>(null);
  const [viewContent, setViewContent]= useState("");
  const [viewLoading, setViewLoading]= useState(false);

  async function loadLogs() {
    setLoading(true);
    try {
      const r = await apiClient.get("/api/v1/debug/logs", { params: { device_type: deviceType } });
      setLogs(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadLogs(); }, []);

  async function handleUpload() {
    if (lines.length === 0) { alert("当前没有日志内容"); return; }
    setUploading(true);
    try {
      const text = lines.join("\n");
      const blob = new Blob([text], { type: "text/plain" });
      const fd   = new FormData();
      fd.append("file",        blob, `${deviceType}_${Date.now()}.txt`);
      fd.append("device_type", deviceType);
      fd.append("description", description.trim());
      await apiClient.post("/api/v1/debug/logs", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDesc("");
      loadLogs();
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "上传失败");
    } finally { setUploading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除此日志记录？")) return;
    await apiClient.delete(`/api/v1/debug/logs/${id}`);
    loadLogs();
  }

  async function handleView(log: LogEntry) {
    setViewing(log); setViewLoading(true); setViewContent("");
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/debug/logs/${log.id}/download`;
      const r   = await apiClient.get(url, { responseType: "text" });
      setViewContent(typeof r.data === "string" ? r.data : JSON.stringify(r.data));
    } catch { setViewContent("加载失败"); }
    finally { setViewLoading(false); }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：保存当前日志 */}
      <div className="px-3 py-2.5 border-b border-border space-y-2 flex-shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">保存日志到服务器</p>
        <input
          value={description}
          onChange={e => setDesc(e.target.value)}
          placeholder="备注说明（可选）"
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-muted/30
                     focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button onClick={handleUpload} disabled={uploading || lines.length === 0}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs
                     bg-primary text-primary-foreground rounded-lg hover:bg-primary/90
                     disabled:opacity-50 transition-colors">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          {uploading ? "上传中..." : `保存（${lines.length} 行）`}
        </button>
      </div>

      {/* 历史日志列表 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <p className="text-xs font-semibold text-muted-foreground">历史日志</p>
        <button onClick={loadLogs} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 text-center">暂无历史日志</p>
        ) : (
          logs.map(log => (
            <div key={log.id} className="px-3 py-2.5 border-b border-border hover:bg-muted/20">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{log.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {log.uploader_name} · {fmtSize(log.file_size)} · {log.line_count} 行
                  </p>
                  {log.description && (
                    <p className="text-xs text-muted-foreground truncate">{log.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleView(log)} title="在线浏览"
                    className="p-1 text-muted-foreground hover:text-primary transition-colors">
                    <Eye size={12} />
                  </button>
                  <a
                    href={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/debug/logs/${log.id}/download`}
                    target="_blank" rel="noreferrer" title="下载"
                    className="p-1 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Download size={12} />
                  </a>
                  <button onClick={() => handleDelete(log.id)} title="删除"
                    className="p-1 text-muted-foreground hover:text-red-500 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 在线浏览弹窗 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <p className="font-semibold text-sm">{viewing.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {viewing.uploader_name} · {fmtSize(viewing.file_size)} · {viewing.line_count} 行
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/debug/logs/${viewing.id}/download`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border
                             rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground"
                >
                  <Download size={12} /> 下载
                </a>
                <button onClick={() => setViewing(null)}>
                  <X size={18} className="text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs leading-5 rounded-b-2xl">
              {viewLoading ? (
                <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
              ) : (
                viewContent.split("\n").map((line, i) => {
                  let color = "text-slate-300";
                  if (/ [EF]\//.test(line) || / E /.test(line)) color = "text-red-400";
                  else if (/ W\//.test(line) || / W /.test(line)) color = "text-yellow-400";
                  else if (/ I\//.test(line) || / I /.test(line)) color = "text-green-400";
                  else if (/ D\//.test(line) || / D /.test(line)) color = "text-blue-400";
                  return (
                    <div key={i} className={`${color} whitespace-pre-wrap break-all`}>
                      <span className="text-slate-600 mr-2 select-none">{i + 1}</span>
                      {line}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
