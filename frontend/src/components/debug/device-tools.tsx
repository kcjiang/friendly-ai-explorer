"use client";

import {
  Cable,
  Download,
  Settings2,
  Square,
  Trash2,
  Upload,
  Usb,
} from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Container from "@/components/container";
import { TopNav } from "@/components/nav";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import {
  type ConnectionKind,
  type DeviceSession,
  defaultSerial,
  deviceSessions,
  useDeviceSession,
} from "@/lib/device-session";
import { DeviceLogToaster } from "./console-log-upload";
import DeviceConsole from "./device-console";
import LogPanel from "./log-panel";
import PresetPanel from "./quick-commands";
import TerminalView from "./terminal-view";

export function useDeviceText() {
  const locale = useLocale();
  return (english: string, chinese: string) =>
    locale === "zh-CN" ? chinese : english;
}
export function downloadDeviceBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeviceToolbar({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Container
      role="toolbar"
      aria-label={label}
      data-page-toolbar
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b py-2"
    >
      {children}
    </Container>
  );
}

export function DeviceSettings({
  title,
  children,
  keepMounted,
}: {
  title: string;
  children: React.ReactNode;
  keepMounted?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" />}>
        <Settings2 />
        {title}
      </PopoverTrigger>
      <PopoverContent
        keepMounted={keepMounted}
        align="end"
        className="max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-4"
      >
        <PopoverTitle>{title}</PopoverTitle>
        <div className="space-y-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function SerialParameters({
  inline,
  title,
  children,
}: {
  inline: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return inline ? (
    <div className="w-full space-y-3">{children}</div>
  ) : (
    <DeviceSettings title={title}>{children}</DeviceSettings>
  );
}

export function ConnectionBar({
  kind,
  compact = false,
  label,
  inlineSettings = false,
}: {
  kind: ConnectionKind;
  compact?: boolean;
  label?: string;
  inlineSettings?: boolean;
}) {
  const d = useDeviceText();
  const { session, status, error } = useDeviceSession(kind);
  const [config, setConfig] = useState({
    ...defaultSerial,
    baudRate: kind === "remote" ? 9600 : 115200,
  });
  const busy = status !== "disconnected" && status !== "error";
  const shown = busy ? session.serialSettings : config;
  const labels: Record<string, string> = {
    disconnected: d("Disconnected", "未连接"),
    connecting: d("Connecting", "连接中"),
    auth: d("Allow USB debugging on the device", "请在设备上允许 USB 调试"),
    connected: d("Connected", "已连接"),
    disconnecting: d("Disconnecting", "断开中"),
    error: d("Connection failed", "连接失败"),
  };
  const settingsTitle =
    kind === "remote"
      ? d("Remote serial settings", "遥控串口设置")
      : label
        ? label + d(" settings", "设置")
        : d("Serial settings", "串口设置");
  return (
    <div
      className={
        inlineSettings
          ? "flex flex-col items-stretch gap-3"
          : compact
            ? "flex flex-wrap items-center gap-2"
            : "flex flex-wrap items-center gap-2 border-b pb-3"
      }
    >
      {label && <span className="text-xs font-medium">{label}</span>}
      <span
        role="status"
        className={
          status === "connected"
            ? "text-xs text-green-600"
            : "text-muted-foreground text-xs"
        }
      >
        {labels[status]}
      </span>
      {kind !== "adb" && (
        <SerialParameters inline={inlineSettings} title={settingsTitle}>
          <p className="text-muted-foreground text-xs">
            {busy
              ? d(
                  "Disconnect before changing serial parameters.",
                  "请先断开连接再修改串口参数。",
                )
              : d("Applied on the next connection.", "参数在下次连接时生效。")}
          </p>
          <label className="grid gap-1 text-xs">
            {d("Baud rate", "波特率")}
            <select
              aria-label={d("Baud rate", "波特率")}
              disabled={busy}
              className="bg-background h-8 rounded-md border px-2"
              value={shown.baudRate}
              onChange={(e) =>
                setConfig({ ...config, baudRate: Number(e.target.value) })
              }
            >
              {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs">
              {d("Data bits", "数据位")}
              <select
                aria-label={d("Data bits", "数据位")}
                disabled={busy}
                className="bg-background h-8 rounded-md border px-2"
                value={shown.dataBits}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    dataBits: Number(e.target.value) as 7 | 8,
                  })
                }
              >
                {[7, 8].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              {d("Stop bits", "停止位")}
              <select
                aria-label={d("Stop bits", "停止位")}
                disabled={busy}
                className="bg-background h-8 rounded-md border px-2"
                value={shown.stopBits}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    stopBits: Number(e.target.value) as 1 | 2,
                  })
                }
              >
                {[1, 2].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-xs">
            {d("Parity", "校验位")}
            <select
              aria-label={d("Parity", "校验位")}
              disabled={busy}
              className="bg-background h-8 rounded-md border px-2"
              value={shown.parity}
              onChange={(e) =>
                setConfig({
                  ...config,
                  parity: e.target.value as typeof config.parity,
                })
              }
            >
              {["none", "even", "odd"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              disabled={busy}
              checked={shown.flowControl === "hardware"}
              onChange={(e) =>
                setConfig({
                  ...config,
                  flowControl: e.target.checked ? "hardware" : "none",
                })
              }
            />
            RTS/CTS
          </label>
        </SerialParameters>
      )}
      <Button
        disabled={status === "disconnecting"}
        variant={busy ? "outline" : "default"}
        onClick={() => {
          void (busy ? session.disconnect() : session.connect(config));
        }}
      >
        {kind === "adb" ? <Usb /> : <Cable />}
        {busy
          ? d("Disconnect", "断开连接")
          : kind === "adb"
            ? d("Select USB device", "选择 USB 设备")
            : d("Select serial port", "选择串口")}
      </Button>
      {error && (
        <p className="text-destructive w-full text-xs break-words" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SessionToolbar({
  session,
  compact = false,
}: {
  session: DeviceSession;
  compact?: boolean;
}) {
  const d = useDeviceText();
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "default"}
        title={d("Clear", "清空输出")}
        aria-label={d("Clear", "清空输出")}
        onClick={() => session.clear()}
      >
        <Trash2 />
        {!compact && d("Clear", "清空输出")}
      </Button>
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "default"}
        title={d("Save log", "保存日志")}
        aria-label={d("Save log", "保存日志")}
        onClick={() =>
          downloadDeviceBlob(
            new Blob([session.transcript], {
              type: "text/plain;charset=utf-8",
            }),
            `${session.kind}-${Date.now()}.log`,
          )
        }
      >
        <Download />
        {!compact && d("Save log", "保存日志")}
      </Button>
    </div>
  );
}

function DeviceTerminal() {
  const d = useDeviceText();
  const [commandEditing, setCommandEditing] = useState(false);
  const [kind, setKind] = useState<"adb" | "serial">("adb");
  const { session, status } = useDeviceSession(kind);
  const [error, setError] = useState("");
  const [hex, setHex] = useState(false);
  const [input, setInput] = useState("");
  const [ending, setEnding] = useState("\r\n");
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logcat, setLogcat] = useState(false);
  const stopLogcat = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const report = (error: unknown) => setError(String(error));
  const run = (command: string) => {
    void session
      .write(command.replace(/[\r\n]+$/, "") + (kind === "adb" ? "\r" : ending))
      .catch(report);
  };
  useEffect(
    () => () => {
      stopLogcat.current?.();
    },
    [],
  );
  async function toggleLogcat() {
    if (stopLogcat.current) {
      stopLogcat.current();
      stopLogcat.current = null;
      setLogcat(false);
      return;
    }
    try {
      stopLogcat.current = await session.adb!.startLogcat((line) =>
        session.output(line + "\r\n"),
      );
      setLogcat(true);
    } catch (error) {
      report(error);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DeviceToolbar label={d("Terminal toolbar", "终端工具栏")}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            {d("Connection", "连接方式")}{" "}
            <select
              className="bg-background h-8 rounded-md border px-2 text-sm"
              disabled={commandEditing}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setError("");
              }}
            >
              <option value="adb">USB ADB</option>
              <option value="serial">{d("Serial", "串口")}</option>
            </select>
          </label>
        </div>
        <ConnectionBar kind={kind} compact />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <SessionToolbar session={session} />
          <Button
            variant="outline"
            onClick={() => {
              setLogs(session.transcript.split("\n"));
              setShowLogs(!showLogs);
            }}
          >
            <Upload />
            {d("Uploaded logs", "上传与管理日志")}
          </Button>
          <Button
            variant="outline"
            disabled={status !== "connected"}
            onClick={() => {
              void session.write("\x03").catch(report);
            }}
          >
            <Square />
            Ctrl+C
          </Button>
          {kind === "adb" && (
            <>
              <Button
                variant="outline"
                disabled={status !== "connected" || uploading}
                onClick={() => fileInput.current?.click()}
              >
                <Upload />
                {uploading
                  ? d("Uploading…", "上传中…")
                  : d("Upload & run .sh", "上传并运行 .sh")}
              </Button>
              <Button
                variant={logcat ? "secondary" : "outline"}
                disabled={status !== "connected"}
                onClick={() => {
                  void toggleLogcat();
                }}
              >
                {logcat ? d("Stop Logcat", "停止 Logcat") : "Logcat"}
              </Button>
            </>
          )}
          {kind === "serial" && (
            <DeviceSettings title={d("Terminal settings", "终端设置")}>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={hex}
                  onChange={(e) => {
                    setHex(e.target.checked);
                    session.hex = e.target.checked;
                  }}
                />{" "}
                HEX
              </label>
              <label className="grid gap-1 text-xs">
                {d("Line ending", "换行符")}
                <select
                  aria-label={d("Line ending", "换行符")}
                  className="bg-background h-8 rounded-md border px-2"
                  value={ending}
                  onChange={(e) => setEnding(e.target.value)}
                >
                  <option value="">None</option>
                  <option value={"\r"}>CR</option>
                  <option value={"\n"}>LF</option>
                  <option value={"\r\n"}>CRLF</option>
                </select>
              </label>
            </DeviceSettings>
          )}
        </div>
      </DeviceToolbar>
      <Container className="flex min-h-0 flex-1 flex-col gap-3 py-4">
        <p className="text-muted-foreground text-xs">
          {d(
            "Connections remain active when switching pages in this tab.",
            "当前标签页内切换页面保持连接，刷新或关闭后断开。",
          )}
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".sh"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) {
              setUploading(true);
              setError("");
              void session
                .uploadScript(file)
                .catch(report)
                .finally(() => setUploading(false));
            }
          }}
        />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-96 flex-col overflow-hidden rounded-xl border xl:min-h-0">
            <div className="min-h-80 flex-1">
              <TerminalView session={session} report={report} />
            </div>
            <form
              className="flex gap-2 border-t p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (hex && kind === "serial") {
                  const value = input.replace(/\s/g, "");
                  if (!/^(?:[\da-f]{2})+$/i.test(value)) {
                    setError(
                      d(
                        "Enter complete HEX byte pairs",
                        "请输入完整的 HEX 字节对",
                      ),
                    );
                    return;
                  }
                  void session
                    .write(
                      Uint8Array.from(value.match(/../g)!, (b) =>
                        parseInt(b, 16),
                      ),
                    )
                    .catch(report);
                } else run(input);
                setInput("");
              }}
            >
              <Input
                aria-label={d("Command", "命令")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={d(
                  "Quick command (the terminal also accepts direct input)",
                  "快捷命令（也可直接在终端中输入）",
                )}
              />
              <Button type="submit" disabled={status !== "connected"}>
                {d("Send", "发送")}
              </Button>
            </form>
          </div>
          <aside className="overflow-y-auto rounded-xl border">
            <PresetPanel
              key={kind}
              deviceType={kind}
              onEditingChange={setCommandEditing}
              onRun={run}
              disabled={status !== "connected"}
            />
            {showLogs && <LogPanel deviceType={kind} lines={logs} />}
          </aside>
        </div>
      </Container>
    </div>
  );
}

// Mounted under the application layout, so route changes do not destroy media or sessions.
export default function DeviceTools() {
  const pathname = usePathname();
  const d = useDeviceText();
  const [visited, setVisited] = useState({ terminal: false, console: false });
  const terminal = pathname === "/terminal",
    consolePage = pathname === "/device-console";
  useEffect(() => {
    setVisited((old) => ({
      terminal: old.terminal || terminal,
      console: old.console || consolePage,
    }));
  }, [terminal, consolePage]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        Object.values(deviceSessions).some(
          (s) => s.snapshot().status === "connected",
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      Object.values(deviceSessions).forEach((s) => {
        void s.disconnect();
      });
    };
  }, []);
  return (
    <>
      <DeviceLogToaster />
      <div
        className={
          terminal || consolePage ? "flex h-screen flex-col" : "hidden"
        }
      >
        <TopNav
          title={
            terminal
              ? d("Device Terminal", "设备终端")
              : d("Device Console", "设备控制台")
          }
        />
        <div className={terminal ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
          {(visited.terminal || terminal) && <DeviceTerminal />}
        </div>
        <div
          className={consolePage ? "min-h-0 flex-1 overflow-auto" : "hidden"}
        >
          {(visited.console || consolePage) && <DeviceConsole />}
        </div>
      </div>
    </>
  );
}
