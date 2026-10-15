"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface LogEntry {
  id: string; timestamp: string; level: string; logger: string;
  message: string; request_id: string; details: Record<string, unknown>;
}
interface LogPage { items: LogEntry[]; total: number; page: number; page_size: number; truncated: boolean }
const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm w-full";
const button = "rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 disabled:opacity-50";

export default function AppLogs({ initialRequestId = "" }: { initialRequestId?: string }) {
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [requestId, setRequestId] = useState(initialRequestId);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [filters, setFilters] = useState({ level: "", q: "", request_id: initialRequestId, since: "", until: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LogPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [expanded, setExpanded] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      const params = Object.fromEntries(Object.entries({ ...filters, page, page_size: 50 }).filter(([, value]) => value !== ""));
      const response = await api.get("/api/v1/admin/logs", { params, signal });
      if (!signal?.aborted) setResult(response.data);
    } catch (e) { if (!signal?.aborted) setError(errorMessage(e)); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [filters, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!auto || page !== 1) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => clearInterval(timer);
  }, [auto, page, load]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    if (since && until && new Date(since) > new Date(until)) { setError("开始时间不能晚于结束时间"); return; }
    setPage(1); setExpanded("");
    setFilters({ level, q: query, request_id: requestId, since: since ? new Date(since).toISOString() : "", until: until ? new Date(until).toISOString() : "" });
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div><h2 className="font-semibold">应用日志</h2><p className="text-xs text-muted-foreground mt-1">查看请求、AI 重试、降级和异常。可通过请求编号关联同一次操作。时间按当前浏览器时区显示。</p></div>
      <button className={button} disabled={busy} onClick={() => void load()}><RefreshCw className="inline mr-1" size={14} />刷新</button>
    </div>
    <form onSubmit={search} className="rounded-xl border border-border p-4 space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-xs space-y-1">级别<select className={field} value={level} onChange={e => setLevel(e.target.value)}><option value="">全部级别</option>{["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map(l => <option key={l}>{l}</option>)}</select></label>
        <label className="text-xs space-y-1">关键词<input className={field} maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder="如 todo、timeout、向量化" /></label>
        <label className="text-xs space-y-1">请求编号<input className={field} maxLength={64} value={requestId} onChange={e => setRequestId(e.target.value)} placeholder="粘贴 X-Request-ID" /></label>
        <label className="text-xs space-y-1">开始时间<input type="datetime-local" className={field} value={since} onChange={e => setSince(e.target.value)} /></label>
        <label className="text-xs space-y-1">结束时间<input type="datetime-local" className={field} value={until} onChange={e => setUntil(e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <button className={button} disabled={busy}><Search size={14} className="inline mr-1" />查询</button>
        <button type="button" className={button} disabled={busy} onClick={() => { setLevel(""); setQuery(""); setRequestId(""); setSince(""); setUntil(""); setPage(1); setFilters({ level: "", q: "", request_id: "", since: "", until: "" }); }}>清空筛选</button>
        <label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />每 10 秒刷新第一页</label>
        {busy && <Loader2 size={16} className="animate-spin" />}
      </div>
    </form>
    {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
    <p className="text-xs text-muted-foreground">日志自动轮转，最多约 25 MB；每次搜索最多扫描最近 10,000 条。不会记录请求正文、模型思考正文或完整业务资料。{result?.truncated && " 当前日志较多，结果仅涵盖最近扫描范围。"}</p>
    <div className="rounded-xl border border-border overflow-x-auto"><table className="w-full text-xs table-fixed"><thead className="bg-muted/40"><tr>{["时间 / 级别", "事件", "来源 / 请求编号", "详情"].map(h => <th className={`text-left p-3 ${h === "详情" ? "w-16" : ""}`} key={h}>{h}</th>)}</tr></thead><tbody>
      {result?.items.map(row => <LogRow key={row.id} row={row} expanded={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? "" : row.id)} onRequest={() => { setRequestId(row.request_id); setPage(1); setFilters({ ...filters, request_id: row.request_id }); }} />)}
      {!result?.items.length && !busy && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">暂无符合条件的日志</td></tr>}
    </tbody></table></div>
    <div className="flex items-center justify-between text-xs gap-3"><span>扫描范围内共 {result?.total ?? 0} 条 · 第 {page} 页</span><div className="flex gap-2"><button className={button} disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button><button className={button} disabled={busy || page * 50 >= (result?.total ?? 0)} onClick={() => setPage(p => p + 1)}>下一页</button></div></div>
  </div>;
}

function LogRow({ row, expanded, onToggle, onRequest }: { row: LogEntry; expanded: boolean; onToggle: () => void; onRequest: () => void }) {
  const color = ["ERROR", "CRITICAL"].includes(row.level) ? "text-red-600" : row.level === "WARNING" ? "text-amber-600" : "text-muted-foreground";
  return <><tr className="border-t border-border align-top"><td className="p-3 break-words">{new Date(row.timestamp).toLocaleString("zh-CN")}<p className={`mt-1 font-medium ${color}`}>{row.level}</p></td><td className="p-3 break-words">{row.message}</td><td className="p-3 break-all text-muted-foreground">{row.logger}{row.request_id && <button className="block mt-1 text-left text-primary hover:underline font-mono" onClick={onRequest} title="筛选该请求">{row.request_id}</button>}</td><td className="p-3"><button className="text-primary hover:underline whitespace-nowrap" onClick={onToggle}>{expanded ? "收起" : "展开"}</button></td></tr>{expanded && <tr><td colSpan={4} className="bg-muted/20 p-4"><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(row.details, null, 2)}</pre></td></tr>}</>;
}
