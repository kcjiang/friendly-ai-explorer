"use client";

import { Loader2, RefreshCw, Search } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import { NativeSelect } from "@/components/ui/base/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/base/table";
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
const field = "w-full";

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
          <h2 className="font-semibold">{t("ui.systemLogs")}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t(
              "ui.viewRequestsAiRetriesFallbacksAndExceptionsCorrelateOperationsByRequestId",
            )}
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-1 inline" size={14} />
          {t("ui.refresh")}
        </Button>
      </div>
      <form
        onSubmit={search}
        className="border-border space-y-3 rounded-xl border p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Label className="block space-y-1 text-xs">
            {t("ui.level")}
            <NativeSelect
              className={field}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">{t("ui.allLevels")}</option>
              {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="block space-y-1 text-xs">
            {t("ui.keyword")}
            <Input
              className={field}
              maxLength={100}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ui.eGTodoTimeoutEmbeddings")}
            />
          </Label>
          <Label className="block space-y-1 text-xs">
            {t("ui.requestId2")}
            <Input
              className={field}
              maxLength={64}
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder={t("ui.pasteXRequestId")}
            />
          </Label>
          <Label className="block space-y-1 text-xs">
            {t("ui.startTime")}
            <Input
              type="datetime-local"
              className={field}
              value={since}
              onChange={(e) => setSince(e.target.value)}
            />
          </Label>
          <Label className="block space-y-1 text-xs">
            {t("ui.endTime")}
            <Input
              type="datetime-local"
              className={field}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={busy}>
            <Search size={14} className="mr-1 inline" />
            {t("ui.search")}
          </Button>
          <Button
            variant="outline"
            type="button"
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
          </Button>
          <Label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={auto}
              onCheckedChange={(checked) => setAuto(checked === true)}
            />
            {t("ui.refreshFirstPageEvery10Seconds")}
          </Label>
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
        <Table className="w-full table-fixed text-xs">
          <TableHeader className="bg-muted/40">
            <TableRow>
              {[
                t("ui.timeLevel"),
                t("ui.event"),
                t("ui.sourceRequestId"),
                t("ui.details"),
              ].map((h) => (
                <TableHead
                  className={`p-3 text-left ${h === t("ui.details") ? "w-16" : ""}`}
                  key={h}
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
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
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground p-8 text-center"
                >
                  {t("ui.noMatchingLogs")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span>
          {t("ui.totalInScannedRange")}
          {result?.total ?? 0} {t("ui.itemsPage")}
          {page} {t("ui.page")}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("ui.previous")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || page * 50 >= (result?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("ui.next")}
          </Button>
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
      <TableRow className="border-border border-t align-top">
        <TableCell className="p-3 break-words">
          {new Date(row.timestamp).toLocaleString(locale)}
          <p className={`mt-1 font-medium ${color}`}>{row.level}</p>
        </TableCell>
        <TableCell className="p-3 break-words">{row.message}</TableCell>
        <TableCell className="text-muted-foreground p-3 break-all">
          {row.logger}
          {row.request_id && (
            <Button
              variant="outline"
              className="text-primary mt-1 block text-left font-mono hover:underline"
              onClick={onRequest}
              title={t("ui.filterByThisRequest")}
            >
              {row.request_id}
            </Button>
          )}
        </TableCell>
        <TableCell className="p-3">
          <Button
            variant="outline"
            className="text-primary whitespace-nowrap hover:underline"
            onClick={onToggle}
          >
            {expanded ? t("ui.collapse") : t("ui.expand")}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={4} className="bg-muted/20 p-4">
            <pre className="max-h-96 overflow-auto text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(row.details, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
