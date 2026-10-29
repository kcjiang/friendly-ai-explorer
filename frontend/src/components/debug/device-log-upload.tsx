"use client";

import { CircleAlert, CircleCheck, Info, Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/base/button";
import {
  Toast,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  useToastManager,
} from "@/components/ui/base/toast";
import { deviceLogName } from "@/lib/device-log-name";
import { errorMessage } from "@/lib/errors";
import {
  type LogUploadNotice,
  createLogUploadTask,
} from "@/lib/log-upload-task";
import { uploadManager } from "@/lib/upload-manager";

export type DeviceLogKind = "adb" | "serial";
type UploadToastData = { upload: LogUploadNotice; deviceType: DeviceLogKind };
const manager = createToastManager<UploadToastData>();
function noticeOptions(deviceType: DeviceLogKind, notice: LogUploadNotice) {
  return {
    title: "Log upload",
    type: notice.phase === "uploading" ? "loading" : notice.phase,
    timeout: notice.phase === "uploading" ? 0 : 7000,
    data: { upload: notice, deviceType },
    onClose: notice.onClose,
  };
}
function createDeviceLogUpload(deviceType: DeviceLogKind) {
  return createLogUploadTask({
    upload: async (text, signal, progress) => {
      const file = new File([text], deviceLogName(deviceType), {
        type: "text/plain;charset=utf-8",
      });
      const task = await uploadManager.enqueue(
        file,
        {
          purpose: "log",
          device_type: deviceType,
          conflict: "keep",
          client_timezone_offset_minutes: new Date().getTimezoneOffset(),
        },
        { signal, progress },
      ).promise;
      return { filename: task.filename };
    },
    notices: {
      add: (notice) => manager.add(noticeOptions(deviceType, notice)),
      update: (id, notice) =>
        manager.update(id, noticeOptions(deviceType, notice)),
    },
  });
}
export const deviceLogUploads = {
  adb: createDeviceLogUpload("adb"),
  serial: createDeviceLogUpload("serial"),
};
export function useDeviceLogUpload(deviceType: DeviceLogKind) {
  const task = deviceLogUploads[deviceType];
  return useSyncExternalStore(
    task.subscribe,
    task.getSnapshot,
    task.getSnapshot,
  );
}
function UploadNotices() {
  const locale = useLocale();
  const d = (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
  const { toasts } = useToastManager<UploadToastData>();
  return toasts.map((item) => {
    const n = item.data?.upload;
    if (!n) return null;
    const active = n.phase === "uploading";
    const title = active
      ? n.progress === 100
        ? d("Saving log…", "正在保存日志…")
        : d("Uploading log…", "正在上传日志…")
      : n.phase === "success"
        ? d("Log uploaded", "日志上传完成")
        : n.phase === "cancelled"
          ? d("Upload cancelled", "已取消上传")
          : n.phase === "empty"
            ? d("No log content to upload", "暂无可上传的日志")
            : d("Log upload failed", "日志上传失败");
    return (
      <Toast
        key={item.id}
        toast={item}
        data-upload-notice={item.id}
        data-upload-phase={n.phase}
      >
        <ToastContent className="items-start">
          {active ? (
            <Loader2
              className="mt-0.5 size-4 shrink-0 animate-spin"
              aria-hidden
            />
          ) : n.phase === "success" ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : n.phase === "error" ? (
            <CircleAlert
              className="text-destructive mt-0.5 size-4 shrink-0"
              aria-hidden
            />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <ToastTitle>
              {item.data?.deviceType === "adb"
                ? "USB ADB"
                : d("Serial", "串口")}{" "}
              · {title}
            </ToastTitle>
            <ToastDescription className="break-words">
              {active
                ? n.progress === 100
                  ? d(
                      "Waiting for the server to finish saving.",
                      "等待服务器保存完成。",
                    )
                  : n.progress === null
                    ? d("Transferring log…", "正在传输日志…")
                    : `${n.progress}%`
                : n.phase === "success"
                  ? n.filename
                  : n.phase === "error"
                    ? errorMessage(n.error, d("Please try again.", "请重试。"))
                    : null}
            </ToastDescription>
            {active && (
              <>
                <div
                  role="progressbar"
                  aria-label={d("Log upload progress", "日志上传进度")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={n.progress ?? undefined}
                  className="bg-muted h-1.5 overflow-hidden rounded-full"
                >
                  <div
                    className={`bg-primary h-full rounded-full ${n.progress === null ? "animate-pulse" : ""}`}
                    style={{ width: `${n.progress ?? 30}%` }}
                  />
                </div>
                <Button
                  className="self-start"
                  size="sm"
                  variant="outline"
                  onClick={n.cancel}
                >
                  {d("Cancel upload", "取消上传")}
                </Button>
              </>
            )}
          </div>
          <ToastClose />
        </ToastContent>
      </Toast>
    );
  });
}
export function DeviceLogToaster() {
  return (
    <ToastProvider toastManager={manager} limit={3}>
      <ToastPortal>
        <ToastViewport>
          <UploadNotices />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

export function useDeviceLogHistoryRevision() {
  const adb = useDeviceLogUpload("adb").revision;
  const serial = useDeviceLogUpload("serial").revision;
  return `${adb}:${serial}`;
}
