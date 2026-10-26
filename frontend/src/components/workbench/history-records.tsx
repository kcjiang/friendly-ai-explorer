"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/base/badge";
import { Button } from "@/components/ui/base/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/base/card";
import { DialogFooter } from "@/components/ui/base/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/base/empty";
import { FieldError } from "@/components/ui/base/field";
import { ScrollArea } from "@/components/ui/base/scroll-area";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Job } from "@/types/workbench";

const labels = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};
export function HistoryRecords({
  automationId,
  open,
  onRetry,
}: {
  automationId: string;
  open: boolean;
  onRetry: () => void;
}) {
  const locale = useLocale();

  const t = useUiTranslations();
  const localizedLabels = translateLabels(labels, t);

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: Job[]; total: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retrying, setRetrying] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setResult(null);
    setLoading(true);
    setError("");
    async function load() {
      try {
        const { data } = await api.get<{ items: Job[]; total: number }>(
          `/api/v1/workbench/automations/${automationId}/jobs`,
          { params: { page, page_size: 30 }, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const last = Math.max(1, Math.ceil(data.total / 30));
        if (page > last) setPage(last);
        else {
          setResult(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(errorMessage(e, t("ui.failedToLoadExecutionHistory")));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, 8000);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [automationId, page, refresh, open, t]);
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 30));
  return (
    <>
      <ScrollArea
        key={page}
        className="-mx-4 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [&>[data-slot=scroll-area-viewport]]:min-h-0"
      >
        <div className="space-y-3 px-4 py-1">
          {(error || actionError) && (
            <FieldError role="alert">
              {actionError || error}
              <Button
                className="ml-2"
                size="xs"
                variant="outline"
                onClick={() => {
                  setActionError("");
                  setRefresh((n) => n + 1);
                }}
              >
                {t("ui.reload")}
              </Button>
            </FieldError>
          )}
          {loading && (
            <p role="status" className="text-muted-foreground py-6 text-sm">
              {t("ui.loadingExecutionHistory")}
            </p>
          )}
          {!loading && !error && result?.total === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("ui.noExecutionHistory")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {result?.items.map((job) => (
            <Card key={job.id} size="sm">
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="min-w-0 break-words">
                    {job.snapshot.payload.title}
                  </CardTitle>
                  <Badge
                    variant={
                      job.status === "failed" ? "destructive" : "secondary"
                    }
                  >
                    {localizedLabels[job.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {new Date(job.queued_at).toLocaleString(locale)}{" "}
                  {t("ui.step2")} {job.step_index}/{job.steps.length}
                </p>
              </CardHeader>
              {(job.error || job.ticket_id || job.status === "failed") && (
                <CardContent className="space-y-2">
                  {job.error && (
                    <p className="text-destructive text-sm break-words whitespace-pre-wrap">
                      {systemMessage(job.error, t)}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {job.status === "failed" && (
                      <Button
                        size="sm"
                        disabled={!!retrying}
                        onClick={async () => {
                          setRetrying(job.id);
                          setActionError("");
                          try {
                            await api.post(
                              `/api/v1/workbench/jobs/${job.id}/retry`,
                            );
                            setPage(1);
                            setRefresh((n) => n + 1);
                            onRetry();
                          } catch (e) {
                            setActionError(errorMessage(e));
                          } finally {
                            setRetrying("");
                          }
                        }}
                      >
                        {retrying === job.id
                          ? t("ui.requeuing")
                          : t("ui.retry")}
                      </Button>
                    )}
                    {job.ticket_id && (
                      <Link className="text-sm underline" href="/ticket">
                        {t("ui.goToTicket")}
                      </Link>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </ScrollArea>
      <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between sm:justify-between">
        <span className="text-muted-foreground text-xs">
          {t("ui.total2")}
          {result?.total ?? 0} {t("ui.itemsRetainedFor30Days")}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page <= 1 || !!retrying}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("ui.previous")}
          </Button>
          <span className="text-xs">
            {page} / {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page >= pages || !!retrying}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("ui.next")}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
