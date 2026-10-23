"use client";
import { useUiTranslations } from "@/i18n/client";

import { errorMessage } from "@/lib/errors";

import { useEffect, useRef, useState } from "react";
import {
  Usb,
  Terminal,
  Activity,
  Play,
  Square,
  Download,
  Loader2,
  AlertTriangle,
  FileText,
} from "lucide-react";
import {
  AdbDevice,
  checkWebUsbSupport,
  type AdbStatus,
} from "@/lib/adb-webusb";
import PresetPanel from "@/components/debug/preset-panel";
import LogPanel from "@/components/debug/log-panel";

type LineType = "sys" | "cmd" | "out" | "err";
interface Line {
  text: string;
  type: LineType;
}

export default function AdbPage() {
  const t = useUiTranslations();

  const [tab, setTab] = useState<"shell" | "logcat">("shell");
  const [status, setStatus] = useState<AdbStatus>("disconnected");
  const [errMsg, setErr] = useState("");
  const [device, setDevice] = useState<AdbDevice | null>(null);
  const wsError = checkWebUsbSupport();

  // 各 tab 的日志行（供保存功能使用）
  const [shellLines, setShellLines] = useState<string[]>([]);
  const [logcatLines, setLogcatLines] = useState<string[]>([]);

  async function connect() {
    setErr("");
    setStatus("connecting");
    try {
      const dev = await AdbDevice.request();
      await dev.connect((s, msg) => {
        setStatus(s);
        if (msg) setErr(msg);
      });
      setDevice(dev);
      setStatus("connected");
    } catch (e: unknown) {
      setStatus("error");
      setErr(errorMessage(e, String(e)));
    }
  }

  async function disconnect() {
    await device?.disconnect();
    setDevice(null);
    setStatus("disconnected");
  }

  const statusBadge = () => {
    switch (status) {
      case "disconnected":
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            {t("ui.disconnected")}
          </span>
        );
      case "connecting":
        return (
          <span className="flex items-center gap-1.5 text-xs text-yellow-500">
            <Loader2 size={12} className="animate-spin" />
            {t("ui.connecting")}
          </span>
        );
      case "auth":
        return (
          <span className="flex items-center gap-1.5 text-xs text-amber-500">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            {t("ui.waitingForDeviceAuthorization")}
          </span>
        );
      case "connected":
        return (
          <span className="flex items-center gap-1.5 text-xs text-green-500">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {t("ui.connected")}
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1.5 text-xs text-red-500">
            <AlertTriangle size={12} />
            {t("ui.connectionFailed")}
          </span>
        );
    }
  };

  if (wsError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800
                        rounded-2xl p-8 max-w-md text-center space-y-3"
        >
          <AlertTriangle size={32} className="text-amber-500 mx-auto" />
          <h2 className="font-bold text-base">
            {t("ui.webusbIsNotSupportedByThisBrowser")}
          </h2>
          <p className="text-sm text-muted-foreground">{wsError}</p>
          <p className="text-xs text-muted-foreground">
            {t("ui.useChromeOrEdge89OverHttpsOrLocalhost")}
          </p>
        </div>
      </div>
    );
  }

  const curLines = tab === "shell" ? shellLines : logcatLines;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部连接栏 */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-wrap bg-muted/10">
        {statusBadge()}
        {errMsg && (status === "auth" || status === "error") && (
          <span
            className={`text-xs truncate max-w-xs ${status === "error" ? "text-red-500" : "text-amber-600 dark:text-amber-400"}`}
          >
            {errMsg}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {status !== "connected" ? (
            <button
              onClick={connect}
              disabled={status === "connecting" || status === "auth"}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary
                         text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              <Usb size={14} />
              {status === "connecting" || status === "auth"
                ? t("ui.connecting")
                : t("ui.selectUsbDevice")}
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm border border-border
                         rounded-lg hover:bg-muted/50 text-muted-foreground"
            >
              {t("ui.disconnect")}
            </button>
          )}
        </div>
        <div className="flex border border-border rounded-lg overflow-hidden">
          {(
            [
              ["shell", "Shell", <Terminal key="shell" size={13} />],
              ["logcat", "Logcat", <Activity key="logcat" size={13} />],
            ] as const
          ).map(([k, l, icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                tab === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {icon}
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 未连接提示 */}
      {status !== "connected" && (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground space-y-4">
          <Usb size={48} className="opacity-20" />
          <div className="text-center space-y-2 max-w-sm">
            <p className="font-medium">
              {t("ui.connectAnAndroidDeviceToThisComputer")}
            </p>
            <ol className="text-sm text-left space-y-1 list-decimal list-inside">
              <li>
                {t("ui.enableDeveloperOptionsUsbDebuggingOnTheAndroidDevice")}
              </li>
              <li>{t("ui.connectTheDeviceToThisComputerWithAUsbCable")}</li>
              <li>{t("ui.clickSelectUsbDeviceAndSelectYourDevice")}</li>
              <li>
                {t("ui.onFirstConnectionTapAllowUsbDebuggingOnTheDevice")}
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* 已连接：三栏布局（终端 | 日志 | 预制命令） */}
      {status === "connected" && device && (
        <div className="flex flex-1 overflow-hidden">
          {/* 中间：终端主体 */}
          <div className="flex-1 overflow-hidden min-w-0">
            {tab === "shell" ? (
              <ShellTab device={device} onLinesChange={setShellLines} />
            ) : (
              <LogcatTab device={device} onLinesChange={setLogcatLines} />
            )}
          </div>

          {/* 右侧：日志保存面板（折叠） */}
          <LogSidePanel deviceType="adb" lines={curLines} />

          {/* 最右：预制命令 */}
          <div className="w-52 flex-shrink-0 border-l border-border overflow-hidden flex flex-col">
            <PresetPanel
              deviceType="adb"
              onRun={(cmd) => {
                // 通过自定义事件传递命令给当前 tab
                window.dispatchEvent(
                  new CustomEvent("adb-preset-run", { detail: cmd }),
                );
              }}
              disabled={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── 日志保存侧边栏（可折叠）─────────────────────────────────
function LogSidePanel({
  deviceType,
  lines,
}: {
  deviceType: "adb" | "serial";
  lines: string[];
}) {
  const t = useUiTranslations();

  const [open, setOpen] = useState(false);
  return (
    <div
      className={`flex-shrink-0 border-l border-border transition-all duration-200 ${open ? "w-64" : "w-9"}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full h-full flex flex-col items-center justify-start pt-3 gap-2
                   text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        title={open ? t("ui.collapseLogPanel") : t("ui.expandLogPanel")}
      >
        {!open && (
          <>
            <FileText size={15} />
            <span className="text-xs [writing-mode:vertical-rl] mt-2">
              {t("ui.logManagement")}
            </span>
          </>
        )}
      </button>
      {open && (
        <div
          className="absolute right-52 top-[calc(var(--topnav-h,48px)+40px)] w-64 h-[calc(100vh-88px)]
                        border-l border-border bg-background z-10 flex flex-col overflow-hidden"
        >
          <LogPanel
            deviceType={deviceType}
            lines={lines}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Shell Tab
// ══════════════════════════════════════════════════════════════
function ShellTab({
  device,
  onLinesChange,
}: {
  device: AdbDevice;
  onLinesChange: (l: string[]) => void;
}) {
  const t = useUiTranslations();

  const [lines, setLines] = useState<Line[]>([
    { text: t("ui.faeShellConnectedEnterACommand"), type: "sys" },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [hidx, setHidx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const allText = useRef<string[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // 监听预制命令事件
  useEffect(() => {
    const handler = (e: Event) => {
      const cmd = (e as CustomEvent).detail as string;
      if (cmd) runCmd(cmd);
    };
    window.addEventListener("adb-preset-run", handler);
    return () => window.removeEventListener("adb-preset-run", handler);
  }, [running]);

  function push(text: string, type: LineType = "out") {
    const newLines = text
      .split("\n")
      .filter((l) => l !== undefined)
      .map((l) => ({ text: l, type }));
    setLines((prev) => [...prev, ...newLines]);
    allText.current.push(...newLines.map((l) => l.text));
    onLinesChange([...allText.current]);
  }

  async function runCmd(cmd: string) {
    if (!cmd.trim() || running) return;
    setRunning(true);
    setHistory((h) => [cmd, ...h.slice(0, 99)]);
    setHidx(-1);
    push(`$ ${cmd}`, "cmd");
    try {
      let out = "";
      await device.shell(cmd, (txt) => {
        out += txt;
      });
      push(out.trimEnd() || t("ui.noOutput"));
    } catch (e: unknown) {
      push(errorMessage(e, t("ui.executionFailed")), "err");
    } finally {
      setRunning(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const c = input.trim();
      if (c) {
        setInput("");
        runCmd(c);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = Math.min(hidx + 1, history.length - 1);
      setHidx(i);
      setInput(history[i] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = Math.max(hidx - 1, -1);
      setHidx(i);
      setInput(i === -1 ? "" : history[i]);
    }
  }

  function lineColor(t: LineType) {
    return {
      sys: "text-yellow-400",
      cmd: "text-cyan-400",
      out: "text-green-300",
      err: "text-red-400",
    }[t];
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={lineColor(l.type)}>
            {l.text || "\u00A0"}
          </div>
        ))}
        {running && (
          <div className="text-yellow-400 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" />
            {t("ui.running")}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-800 bg-slate-900">
        <span className="text-cyan-400 font-mono text-sm">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          autoFocus
          placeholder={
            running
              ? t("ui.running")
              : t("ui.enterACommandEnterToRunForHistory")
          }
          className="flex-1 bg-transparent text-green-300 font-mono text-sm outline-none placeholder:text-slate-600 disabled:opacity-50"
        />
        <button
          onClick={() => {
            setLines([{ text: t("ui.terminalCleared"), type: "sys" }]);
            allText.current = [];
            onLinesChange([]);
          }}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          {t("ui.clear")}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Logcat Tab
// ══════════════════════════════════════════════════════════════
function LogcatTab({
  device,
  onLinesChange,
}: {
  device: AdbDevice;
  onLinesChange: (l: string[]) => void;
}) {
  const t = useUiTranslations();

  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const allLines = useRef<string[]>([]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  async function start() {
    setLines([]);
    allLines.current = [];
    setRunning(true);
    const stop = await device.startLogcat((line) => {
      allLines.current.push(line);
      if (allLines.current.length > 3000)
        allLines.current = allLines.current.slice(-3000);
      setLines([...allLines.current]);
      onLinesChange([...allLines.current]);
    }, filter || undefined);
    stopRef.current = stop;
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
  }

  function downloadLog() {
    const blob = new Blob([allLines.current.join("\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logcat_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function lc(l: string) {
    if (/ [EF]\//.test(l) || / E /.test(l)) return "text-red-400";
    if (/ W\//.test(l) || / W /.test(l)) return "text-yellow-400";
    if (/ I\//.test(l) || / I /.test(l)) return "text-green-400";
    if (/ D\//.test(l) || / D /.test(l)) return "text-blue-400";
    return "text-slate-400";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-wrap bg-muted/10">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={running}
          placeholder={t("ui.tagFilterOptional")}
          className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background
                     focus:outline-none focus:ring-2 focus:ring-primary/30 w-52 disabled:opacity-50"
        />
        {!running ? (
          <button
            onClick={start}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600"
          >
            <Play size={13} />
            {t("ui.startCapture")}
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            <Square size={13} />
            {t("ui.stop")}
          </button>
        )}
        {running && (
          <span className="flex items-center gap-1.5 text-sm text-green-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t("ui.capturing")}
            {lines.length} {t("ui.lines")}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {lines.length > 0 && (
            <button
              onClick={downloadLog}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted/50 text-muted-foreground"
            >
              <Download size={13} />
              {t("ui.download")}
            </button>
          )}
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-primary"
            />
            {t("ui.autoScroll")}
          </label>
          <button
            onClick={() => {
              setLines([]);
              allLines.current = [];
              onLinesChange([]);
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("ui.clear")}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-950 font-mono text-xs p-4 leading-5">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <Activity size={32} className="mb-2 opacity-40" />
            <p>{t("ui.clickStartCaptureToCollectLogs")}</p>
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${lc(l)}`}>
              {l}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
