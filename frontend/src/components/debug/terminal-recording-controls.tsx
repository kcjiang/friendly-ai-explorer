"use client";

import { Circle, FolderOpen, Square } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Label } from "@/components/ui/base/label";
import { NativeSelect } from "@/components/ui/base/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import { downloadDeviceBlob } from "@/lib/device-download";
import { deviceLogName } from "@/lib/device-log-name";
import type { DeviceSession } from "@/lib/device-session";
import {
  type CachedRecording,
  chooseLogDirectory,
  getTerminalRecorder,
  recordingCache,
  recoverCachedRecording,
} from "@/lib/terminal-recording";

function size(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
export default function TerminalRecordingControls({
  session,
  compact,
}: {
  session: DeviceSession;
  compact?: boolean;
}) {
  const zh = useLocale() === "zh-CN";
  const recorder = getTerminalRecorder(session);
  const state = useSyncExternalStore(
    recorder.subscribe,
    recorder.snapshot,
    recorder.snapshot,
  );
  const connection = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const { raw, timestamps, rotateMiB } = session.recordingOptions;
  const setRaw = (value: boolean) =>
    session.configure({
      recordingOptions: {
        ...session.recordingOptions,
        raw: value,
        timestamps: value ? false : session.recordingOptions.timestamps,
      },
    });
  const setTimestamps = (value: boolean) =>
    session.configure({
      recordingOptions: { ...session.recordingOptions, timestamps: value },
    });
  const setRotate = (value: number) =>
    session.configure({
      recordingOptions: { ...session.recordingOptions, rotateMiB: value },
    });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cached, setCached] = useState<CachedRecording[]>([]);
  const active = ["recording", "saving"].includes(state.status);
  useEffect(() => {
    if (!active && state.status !== "error") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active, state.status]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const label = active
    ? zh
      ? "日志记录中"
      : "Recording log"
    : state.status === "error"
      ? zh
        ? "日志保存失败"
        : "Log save failed"
      : zh
        ? "持续记录"
        : "Record session";
  return (
    <Popover
      onOpenChange={(open) => {
        if (open)
          void recordingCache
            .list()
            .then((items) =>
              setCached(
                items.filter(
                  (x) =>
                    x.pending && x.kind === session.kind && x.id !== state.id,
                ),
              ),
            )
            .catch((e) => setError(String(e)));
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size={compact ? "icon-sm" : "default"}
            aria-label={label}
            title={label}
            className={
              state.status === "error"
                ? "text-destructive"
                : active
                  ? "text-red-600"
                  : undefined
            }
          />
        }
      >
        <Circle className={active ? "fill-current" : ""} />
        {!compact && label}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-auto p-3"
      >
        <PopoverTitle>
          {zh ? "持续日志记录（手动启动）" : "Session logging (manual start)"}
        </PopoverTitle>
        <p className="text-muted-foreground text-xs">
          {zh
            ? "只记录开始后的输出，不受清屏影响。连接设备不会自动生成文件。保存到本地，每 2 秒提交；浏览器缓存约每 250ms 更新。异常关闭仍可能丢失最后一小段。"
            : "Records new output independently of clearing the screen. No automatic recording. Local files commit every 2s, recovery cache updates about every 250ms. Abrupt closure can still lose the latest data."}
        </p>
        <Label className="flex items-center gap-2">
          <Checkbox
            disabled={active || state.status === "error"}
            checked={raw}
            onCheckedChange={(v) => setRaw(v === true)}
          />
          {zh ? "保留 ANSI 控制序列" : "Preserve ANSI sequences"}
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox
            disabled={active || raw || state.status === "error"}
            checked={timestamps && !raw}
            onCheckedChange={(v) => setTimestamps(v === true)}
          />
          {zh ? "每行添加接收时间（UTC）" : "Add receive timestamps (UTC)"}
        </Label>
        <Label className="grid gap-1">
          {zh ? "分文件大小" : "Rotate file at"}
          <NativeSelect
            disabled={active || state.status === "error"}
            value={rotateMiB}
            onChange={(e) => setRotate(Number(e.target.value))}
          >
            {[4, 16, 64].map((n) => (
              <option key={n} value={n}>
                {n} MiB
              </option>
            ))}
          </NativeSelect>
        </Label>
        {state.started > 0 && (
          <div className="space-y-1 text-xs break-all" role="status">
            <p>
              {state.directory} / {state.file}
            </p>
            <p>
              {zh ? "记录时长" : "Duration"} {state.elapsed}s ·{" "}
              {zh ? "已接收" : "Received"} {size(state.bytes)} ·{" "}
              {zh ? "已提交到文件" : "Committed to file"} {size(state.saved)}
            </p>
            <p>
              {state.status === "stopped"
                ? zh
                  ? "已停止并保存"
                  : "Stopped and saved"
                : state.status === "saving"
                  ? zh
                    ? "正在完成保存…"
                    : "Finishing save…"
                  : ""}
            </p>
          </div>
        )}
        {(error || state.error || state.cacheError) && (
          <p role="alert" className="text-destructive text-xs break-words">
            {[error, state.error, state.cacheError].filter(Boolean).join("\n")}
          </p>
        )}
        {state.status === "error" && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void run(async () => {
                const directory = await chooseLogDirectory();
                await recorder.savePendingTo(directory);
              })
            }
          >
            <FolderOpen />
            {zh ? "选择目录并保存未提交数据" : "Save pending data to a folder"}
          </Button>
        )}
        {state.status === "error" && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void run(async () => {
                const blob = await recorder.exportPending();
                downloadDeviceBlob(blob, deviceLogName(session.kind));
              })
            }
          >
            {zh
              ? "下载内存中的未提交数据（保留缓存）"
              : "Download unsaved data (keep recovery cache)"}
          </Button>
        )}
        {active ? (
          <Button
            disabled={busy || state.status === "saving"}
            variant="outline"
            onClick={() => void run(() => recorder.stop())}
          >
            <Square />
            {zh ? "停止并保存" : "Stop and save"}
          </Button>
        ) : (
          <Button
            disabled={
              busy ||
              connection.status !== "connected" ||
              state.status === "error"
            }
            onClick={() =>
              void run(async () => {
                const directory = await chooseLogDirectory();
                if (session.snapshot().status !== "connected")
                  throw new Error(
                    zh
                      ? "设备已断开，请重新连接后开始记录。"
                      : "Device disconnected; reconnect before starting.",
                  );
                await recorder.start(directory, {
                  raw,
                  timestamps: timestamps && !raw,
                  rotateMiB,
                });
                if (
                  !["connected", "reconnecting"].includes(
                    session.snapshot().status,
                  )
                )
                  await recorder.stop();
              })
            }
          >
            <Circle />
            {zh ? "选择文件夹并开始记录" : "Choose folder and start"}
          </Button>
        )}
        <p className="text-muted-foreground text-xs">
          {zh
            ? "断电恢复期间继续同一次记录；手动断开时结束保存。保存失败会停止记录并保留待恢复数据。"
            : "Recording continues through device recovery. Manual disconnect finishes saving. Save failures stop recording and retain pending data."}
        </p>
        {cached.length > 0 && (
          <div className="space-y-2 border-t pt-2">
            <p className="text-xs">
              {zh
                ? "发现上次未完成保存的缓存"
                : "Unsaved data from earlier sessions"}
            </p>
            {cached.map((item) => (
              <div key={item.id} className="space-y-1">
                <p className="text-xs break-all">
                  {new Date(item.started).toLocaleString()} ·{" "}
                  {size(new TextEncoder().encode(item.pending).length)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const dir = await chooseLogDirectory();
                      await recoverCachedRecording(item, dir);
                      setCached((old) => old.filter((x) => x.id !== item.id));
                    })
                  }
                >
                  {zh ? "恢复到文件夹" : "Recover to folder"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
