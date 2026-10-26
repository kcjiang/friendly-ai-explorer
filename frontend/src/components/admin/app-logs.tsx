"use client";

import { Loader2, RefreshCw, Search } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useUiTranslations } from "@/i18n/client";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  request_id: string;
  details: Record<string, unknown>;
}
interface LogPage {
  items: LogEntry[];
  total: number;
  page: number;
  page_size: number;
  truncated: boolean;
}
const field =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm w-full";
const button =
  "rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 disabled:opacity-50";

export default function AppLogs({
  initialRequestId = "",
}: {
  initialRequestId?: string;
}) {
  const t = useUiTranslations();

  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [requestId, setRequestId] = useState(initialRequestId);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [filters, setFilters] = useState({
    level: "",
    q: "",
    request_id: initialRequestId,
    since: "",
    until: "",
  });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LogPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [expanded, setExpanded] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setError("");
      try {
        const params = Object.fromEntries(
          Object.entries({ ...filters, page, page_size: 50 }).filter(
            ([, value]) => value !== "",
          ),
        );
        const response = await api.get("/api/v1/admin/logs", {
          params,
          signal,
        });
        if (!signal?.aborted) setResult(response.data);
      } catch (e) {
        if (!signal?.aborted) setError(errorMessage(e));
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [filters, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!auto || page !== 1) return;
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10_000);
    return () => clearInterval(timer);
  }, [auto, page, load]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    if (since && until && new Date(since) > new Date(until)) {
      setError(t("ui.startTimeMustNotBeAfterEndTime"));
      return;
    }
    setPage(1);
    setExpanded("");
    setFilters({
      level,
      q: query,
      request_id: requestId,
      since: since ? new Date(since).toISOString() : "",
      until: until ? new Date(until).toISOString() : "",
    });
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("ui.applicationLogs")}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t(
              "ui.viewRequestsAiRetriesFallbacksAndExceptionsCorrelateOperationsByRequestId",
            )}
          </p>
        </div>
        <button className={button} disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-1 inline" size={14} />
          {t("ui.refresh")}
        </button>
      </div>
      <form
        onSubmit={search}
        className="border-border space-y-3 rounded-xl border p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs">
            {t("ui.level")}
            <select
              className={field}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">{t("ui.allLevels")}</option>
              {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            {t("ui.keyword")}
            <input
              className={field}
              maxLength={100}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ui.eGTodoTimeoutEmbeddings")}
            />
          </label>
          <label className="space-y-1 text-xs">
            {t("ui.requestId2")}
            <input
              className={field}
              maxLength={64}
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder={t("ui.pasteXRequestId")}
            />
          </label>
          <label className="space-y-1 text-xs">
            {t("ui.startTime")}
            <input
              type="datetime-local"
              className={field}
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            {t("ui.endTime")}
            <input
              type="datetime-local"
              className={field}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className={button} disabled={busy}>
            <Search size={14} className="mr-1 inline" />
            {t("ui.search")}
          </button>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              setLevel("");
              setQuery("");
              setRequestId("");
              setSince("");
              setUntil("");
              setPage(1);
              setFilters({
                level: "",
                q: "",
                request_id: "",
                since: "",
                until: "",
              });
            }}
          >
            {t("ui.clearFilters")}
          </button>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            {t("ui.refreshFirstPageEvery10Seconds")}
          </label>
          {busy && <Loader2 size={16} className="animate-spin" />}
        </div>
      </form>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        {t("ui.logsRotateAtApproximately25MbEachSearchScansUpTo10")}
        {result?.truncated &&
          t("ui.thereAreManyLogsResultsCoverOnlyTheMostRecentlyScannedEntries")}
      </p>
      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full table-fixed text-xs">
          <thead className="bg-muted/40">
            <tr>
              {[
                t("ui.timeLevel"),
                t("ui.event"),
                t("ui.sourceRequestId"),
                t("ui.details"),
              ].map((h) => (
                <th
                  className={`p-3 text-left ${h === t("ui.details") ? "w-16" : ""}`}
                  key={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.items.map((row) => (
              <LogRow
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(expanded === row.id ? "" : row.id)}
                onRequest={() => {
                  setRequestId(row.request_id);
                  setPage(1);
                  setFilters({ ...filters, request_id: row.request_id });
                }}
              />
            ))}
            {!result?.items.length && !busy && (
              <tr>
                <td
                  colSpan={4}
                  className="text-muted-foreground p-8 text-center"
                >
                  {t("ui.noMatchingLogs")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span>
          {t("ui.totalInScannedRange")}
          {result?.total ?? 0} {t("ui.itemsPage")}
          {page} {t("ui.page")}
        </span>
        <div className="flex gap-2">
          <button
            className={button}
            disabled={busy || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("ui.previous")}
          </button>
          <button
            className={button}
            disabled={busy || page * 50 >= (result?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("ui.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogRow({
  row,
  expanded,
  onToggle,
  onRequest,
}: {
  row: LogEntry;
  expanded: boolean;
  onToggle: () => void;
  onRequest: () => void;
}) {
  const locale = useLocale();

  const t = useUiTranslations();

  const color = ["ERROR", "CRITICAL"].includes(row.level)
    ? "text-red-600"
    : row.level === "WARNING"
      ? "text-amber-600"
      : "text-muted-foreground";
  return (
    <>
      <tr className="border-border border-t align-top">
        <td className="p-3 break-words">
          {new Date(row.timestamp).toLocaleString(locale)}
          <p className={`mt-1 font-medium ${color}`}>{row.level}</p>
        </td>
        <td className="p-3 break-words">{row.message}</td>
        <td className="text-muted-foreground p-3 break-all">
          {row.logger}
          {row.request_id && (
            <button
              className="text-primary mt-1 block text-left font-mono hover:underline"
              onClick={onRequest}
              title={t("ui.filterByThisRequest")}
            >
              {row.request_id}
            </button>
          )}
        </td>
        <td className="p-3">
          <button
            className="text-primary whitespace-nowrap hover:underline"
            onClick={onToggle}
          >
            {expanded ? t("ui.collapse") : t("ui.expand")}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="bg-muted/20 p-4">
            <pre className="max-h-96 overflow-auto text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(row.details, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
