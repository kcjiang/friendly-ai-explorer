"use client";

import { Activity, MessageSquarePlus } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import { downloadDeviceBlob } from "@/lib/device-download";
import type { DeviceSession } from "@/lib/device-session";
import { getTerminalRecorder } from "@/lib/terminal-recording";

export default function TerminalDiagnostics({
  session,
  compact,
}: {
  session: DeviceSession;
  compact?: boolean;
}) {
  const zh = useLocale() === "zh-CN";
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const diag = session.getDiagnostics();
  void tick;
  const recorder = getTerminalRecorder(session);
  const recording = useSyncExternalStore(
    recorder.subscribe,
    recorder.snapshot,
    recorder.snapshot,
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size={compact ? "icon-sm" : "default"}
            aria-label={zh ? "诊断与日志备注" : "Diagnostics and log notes"}
            title={zh ? "诊断与日志备注" : "Diagnostics and log notes"}
          />
        }
      >
        <Activity />
        {!compact && (zh ? "诊断与备注" : "Diagnostics / notes")}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[75vh] w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-auto p-3"
      >
        <PopoverTitle>
          {zh ? "连接诊断与日志备注" : "Connection diagnostics and log notes"}
        </PopoverTitle>
        <dl className="grid grid-cols-2 gap-1 text-xs">
          <dt>{zh ? "状态／会话时长" : "Status / duration"}</dt>
          <dd>
            {diag.status} · {diag.elapsedSeconds}s
          </dd>
          <dt>{zh ? "接收／发送" : "RX / TX"}</dt>
          <dd>
            {diag.received} / {diag.transmitted} B
          </dd>
          <dt>{zh ? "读取恢复／重新连接" : "Read recovery / reconnect"}</dt>
          <dd>
            {diag.readRecoveries} / {diag.reconnects}
          </dd>
          <dt>{zh ? "握手重试" : "Handshake retries"}</dt>
          <dd>{diag.handshakeRetries}</dd>
          <dt>{zh ? "终端尺寸／协议" : "Size / protocol"}</dt>
          <dd>
            {diag.cols}×{diag.rows} · {diag.protocol}
          </dd>
        </dl>
        {session.kind === "adb" && diag.protocol === "legacy" && (
          <p className="text-muted-foreground text-xs">
            {zh
              ? "旧 Shell 不支持窗口尺寸同步，全屏应用的排版可能受限。"
              : "Legacy shell has no resize channel; full-screen application layout may be limited."}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            downloadDeviceBlob(
              new Blob(
                [
                  JSON.stringify(
                    {
                      exportedAt: new Date().toISOString(),
                      ...session.getDiagnostics(),
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              ),
              `${session.kind}-diagnostics-${Date.now()}.json`,
            );
          }}
        >
          {zh ? "导出诊断信息" : "Export diagnostics"}
        </Button>
        <p className="text-muted-foreground text-xs">
          {zh
            ? "只导出状态、参数、计数和最近 100 条事件，不含命令、设备日志、备注正文或认证密钥。字节数为主交互通道载荷，不含 USB/ADB 协议开销和独立 Logcat 通道。"
            : "Exports parameters, counters and the last 100 events, excluding commands, device logs, note text and keys. Bytes count interactive payload only, excluding protocol overhead and separate Logcat traffic."}
        </p>
        <Label className="grid gap-1">
          {zh ? "日志备注" : "Log note"}
          <Input
            maxLength={200}
            value={note}
            placeholder={
              zh
                ? "例如：开始升级／断电重启"
                : "e.g. Begin upgrade / power cycle"
            }
            onChange={(e) => setNote(e.target.value)}
          />
        </Label>
        <Button
          size="sm"
          disabled={!note.trim()}
          onClick={() => {
            try {
              session.addAnnotation(note);
              setNote("");
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <MessageSquarePlus />
          {zh ? "添加备注" : "Add note"}
        </Button>
        <p className="text-muted-foreground text-xs">
          {recording.status === "recording"
            ? zh
              ? "备注写入当前持续日志，不会发给设备。"
              : "Notes are added to the current log file, never sent to the device."
            : zh
              ? "当前未记录：备注只保留在本次页面会话，不会创建日志文件。"
              : "Not recording: notes stay in this page session; no log file is created."}
        </p>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
        <ol className="max-h-40 space-y-1 overflow-auto text-xs">
          {session
            .getAnnotations()
            .slice()
            .reverse()
            .map((item, i) => (
              <li key={`${item.at}-${i}`} className="break-words">
                <time>{new Date(item.at).toLocaleTimeString()}</time> ·{" "}
                {item.text}
              </li>
            ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
