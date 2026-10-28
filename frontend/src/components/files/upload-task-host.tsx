"use client";

import { Pause, Play, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/base/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import { uploadManager } from "@/lib/upload-manager";

const EMPTY: ReturnType<typeof uploadManager.snapshot> = [];
export default function UploadTaskHost() {
  const { data: session, status } = useSession();
  const locale = useLocale();
  const d = (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
  const jobs = useSyncExternalStore(
    uploadManager.subscribe,
    uploadManager.snapshot,
    () => EMPTY,
  );
  const [open, setOpen] = useState(false);
  const [select, setSelect] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (status !== "loading") void uploadManager.bind(session?.user.id || null);
  }, [status, session?.user.id]);
  const active = jobs.filter((j) =>
    ["queued", "hashing", "uploading", "saving", "paused", "error"].includes(
      j.phase,
    ),
  );
  const labels = {
    queued: d("Queued", "排队中"),
    hashing: d("Checking file", "校验文件"),
    uploading: d("Uploading", "上传中"),
    saving: d("Saving", "服务器保存中"),
    complete: d("Complete", "已完成"),
    skipped: d("Skipped", "已跳过"),
    paused: d("Paused", "已暂停"),
    error: d("Failed", "失败"),
    cancelled: d("Cancelled", "已取消"),
  };
  return (
    <>
      {!!jobs.length && (
        <Button
          className="fixed right-6 bottom-24 z-40 shadow-md"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          <Upload />
          {d("Uploads", "上传任务")}
          {active.length ? ` (${active.length})` : ""}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{d("Upload tasks", "上传任务")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-xs">
            {d(
              "Uploads continue across pages. After restarting the browser, select the original file to resume. Unfinished tasks expire after 48 hours without activity.",
              "切换页面继续上传。刷新或重开浏览器后，重新选择原文件即可续传。未完成任务连续 48 小时无活动后过期清理。",
            )}
          </p>
          {jobs.map((j) => (
            <div
              key={j.key}
              className="space-y-2 rounded-lg border p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={j.filename}>
                  {j.filename}
                </span>
                <span className="text-xs">
                  {labels[j.phase]} · {j.percent}%
                </span>
                {["queued", "hashing", "uploading"].includes(j.phase) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={d("Pause", "暂停")}
                    onClick={() => uploadManager.pause(j.key)}
                  >
                    <Pause />
                  </Button>
                )}
                {["paused", "error"].includes(j.phase) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={d("Resume or retry", "继续或重试")}
                    onClick={() => {
                      if (j.needsFile) {
                        setSelect(j.key);
                        input.current?.click();
                      } else uploadManager.resume(j.key);
                    }}
                  >
                    <Play />
                  </Button>
                )}
                {!["complete", "skipped", "cancelled"].includes(j.phase) ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={d("Cancel upload", "取消上传")}
                    onClick={() => void uploadManager.cancel(j.key)}
                  >
                    <X />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={d("Dismiss", "隐藏记录")}
                    onClick={() => uploadManager.dismiss(j.key)}
                  >
                    <X />
                  </Button>
                )}
              </div>
              <div
                className="bg-muted h-1.5 overflow-hidden rounded"
                role="progressbar"
                aria-valuenow={j.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={j.filename}
              >
                <div
                  className="bg-primary h-full"
                  style={{ width: `${j.percent}%` }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {(j.size / 1024 ** 2).toFixed(1)} MiB{" "}
                {j.speed > 0
                  ? ` · ${(j.speed / 1024 ** 2).toFixed(1)} MiB/s`
                  : ""}
              </p>
              {j.error && (
                <p role="alert" className="text-destructive text-xs">
                  {j.error}
                </p>
              )}
              {j.needsFile && (
                <p className="text-muted-foreground text-xs">
                  {d(
                    "Select the original file to verify and resume.",
                    "请选择原文件，校验通过后继续上传。",
                  )}
                </p>
              )}
            </div>
          ))}
        </DialogContent>
      </Dialog>
      <input
        ref={input}
        className="hidden"
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadManager.resume(select, file);
          e.target.value = "";
        }}
      />
    </>
  );
}
