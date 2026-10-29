"use client";

import { History, Loader2, Upload } from "lucide-react";
import { useLocale } from "next-intl";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import type { DeviceSession } from "@/lib/device-session";
import {
  type DeviceLogKind,
  deviceLogUploads,
  useDeviceLogUpload,
} from "./device-log-upload";

const DeviceLogHistory = dynamic(() => import("./device-log-history"), {
  ssr: false,
});

export function DeviceLogUploadButton({
  session,
  compact = false,
}: {
  session: DeviceSession;
  compact?: boolean;
}) {
  // Remote control uses a binary command port, not an uploadable log session.
  if (session.kind === "remote") return null;
  return (
    <UploadButton
      session={session}
      deviceType={session.kind}
      compact={compact}
    />
  );
}
function UploadButton({
  session,
  deviceType,
  compact,
}: {
  session: DeviceSession;
  deviceType: DeviceLogKind;
  compact: boolean;
}) {
  const zh = useLocale() === "zh-CN";
  const upload = useDeviceLogUpload(deviceType);
  const active = upload.phase === "uploading";
  const label = active
    ? zh
      ? "查看上传进度"
      : "Show upload progress"
    : zh
      ? "上传日志"
      : "Upload log";
  return (
    <Button
      variant="outline"
      size={compact ? "icon-sm" : "default"}
      title={label}
      aria-label={label}
      aria-busy={active}
      onClick={() => {
        // Read at click time. The task owns this immutable snapshot across navigation.
        void deviceLogUploads[deviceType].start(session.transcript);
      }}
    >
      {active ? <Loader2 className="animate-spin" /> : <Upload />}
      {!compact && label}
    </Button>
  );
}

export function DeviceLogHistoryButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const zh = useLocale() === "zh-CN";
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const label = zh ? "历史日志" : "Log history";
  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "default"}
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <History />
        {!compact && label}
      </Button>
      {open && <DeviceLogHistory open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
