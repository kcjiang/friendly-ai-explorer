"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Play,
  Send,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import LogPanel from "@/components/debug/log-panel";
import PresetPanel from "@/components/debug/preset-panel";
import { useWindowEvent } from "@/hooks/use-window-event";
import { getBrowserUiLocale } from "@/i18n/browser";
import { useUiTranslations } from "@/i18n/client";
import { checkWebSerialSupport } from "@/lib/adb-webusb";
import { errorMessage } from "@/lib/errors";

interface SerialConfig {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
  flowControl: "none" | "hardware";
}

const DEFAULT_CONFIG: SerialConfig = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

type LineType = "sys" | "tx" | "rx" | "err";
interface Line {
  text: string;
  type: LineType;
  ts: string;
}
function now() {
  return new Date().toLocaleTimeString(getBrowserUiLocale(), { hour12: false });
}
function lc(t: LineType) {
  return {
    sys: "text-yellow-400",
    tx: "text-cyan-400",
    rx: "text-green-300",
    err: "text-red-400",
  }[t];
}

export default function SerialPage() {
  const t = useUiTranslations();

  const [config, setConfig] = useState<SerialConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { text: t("ui.welcomeToFaeSerialDebugging"), type: "sys", ts: now() },
  ]);
  const [input, setInput] = useState("");
  const [hexMode, setHexMode] = useState(false);
  const [lineEnding, setLineEnding] = useState<"none" | "cr" | "lf" | "crlf">(
    "crlf",
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [hidx, setHidx] = useState(-1);
  const [logLines, setLogLines] = useState<string[]>([]);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(
    null,
  );
  const stopRef = useRef(false);
  const allLines = useRef<Line[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const wsError = checkWebSerialSupport();

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  useWindowEvent("serial-preset-run", (event) => {
    const command = (event as CustomEvent<string>).detail;
    if (command) void sendRaw(command);
  });

  function push(text: string, type: LineType) {
    const line: Line = { text, type, ts: now() };
    allLines.current.push(line);
    if (allLines.current.length > 5000)
      allLines.current = allLines.current.slice(-5000);
    setLines([...allLines.current]);
    setLogLines(
      allLines.current.map(
        (l) => `[${l.ts}][${l.type.toUpperCase()}] ${l.text}`,
      ),
    );
  }

  async function connect() {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        flowControl: config.flowControl,
      });
      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      stopRef.current = false;
      setConnected(true);
      push(
        t("dynamic.connectedBps", {
          p0: config.baudRate,
          p1: config.dataBits,
          p2: config.parity[0].toUpperCase(),
          p3: config.stopBits,
        }),
        "sys",
      );
      void readLoop(port);
    } catch (e: unknown) {
      push(
        t("dynamic.connectionFailed", { p0: errorMessage(e, String(e)) }),
        "err",
      );
    }
  }

  async function readLoop(port: SerialPort) {
    const td = new TextDecoder();
    try {
      while (!stopRef.current && port.readable) {
        const reader = port.readable.getReader();
        try {
          while (!stopRef.current) {
            const { value, done } = await reader.read();
            if (done || stopRef.current) break;
            if (!value) continue;
            if (hexMode) {
              push(
                Array.from(value)
                  .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
                  .join(" "),
                "rx",
              );
            } else {
              const text = td.decode(value, { stream: true });
              const parts = text.split(/\r?\n/);
              for (let i = 0; i < parts.length - 1; i++) push(parts[i], "rx");
              if (parts[parts.length - 1]) push(parts[parts.length - 1], "rx");
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch (e: unknown) {
      if (!stopRef.current)
        push(t("dynamic.readError", { p0: errorMessage(e, String(e)) }), "err");
    }
  }

  async function disconnect() {
    stopRef.current = true;
    try {
      writerRef.current?.releaseLock();
    } catch {
      /* The device may already be disconnected. */
    }
    try {
      await portRef.current?.close();
    } catch {
      /* The device may already be disconnected. */
    }
    portRef.current = null;
    writerRef.current = null;
    setConnected(false);
    push(t("ui.disconnected"), "sys");
  }

  async function sendRaw(raw: string) {
    if (!writerRef.current) return;
    const data = new TextEncoder().encode(raw);
    try {
      await writerRef.current.write(data);
      push(`→ ${raw.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}`, "tx");
    } catch (e: unknown) {
      push(t("dynamic.sendFailed", { p0: errorMessage(e, String(e)) }), "err");
    }
  }

  async function send(raw?: string) {
    const text = raw ?? input;
    if (!text || !writerRef.current) return;
    let data: Uint8Array;
    if (hexMode && !raw) {
      const bytes = text
        .trim()
        .split(/\s+/)
        .map((h) => parseInt(h, 16))
        .filter((n) => !isNaN(n));
      data = new Uint8Array(bytes);
    } else {
      let s = text;
      if (!raw) {
        switch (lineEnding) {
          case "cr":
            s += "\r";
            break;
          case "lf":
            s += "\n";
            break;
          case "crlf":
            s += "\r\n";
            break;
        }
      }
      data = new TextEncoder().encode(s);
    }
    try {
      await writerRef.current.write(data);
      push(
        `→ ${(raw ?? text).replace(/\r/g, "\\r").replace(/\n/g, "\\n")}`,
        "tx",
      );
      if (!raw) {
        setHistory((h) => [text, ...h.slice(0, 99)]);
        setHidx(-1);
        setInput("");
      }
    } catch (e: unknown) {
      push(t("dynamic.sendFailed", { p0: errorMessage(e, String(e)) }), "err");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      send();
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

  function downloadLog() {
    const blob = new Blob([logLines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `serial_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (wsError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTriangle size={32} className="mx-auto text-amber-500" />
          <h2 className="text-base font-bold">
            {t("ui.webSerialIsNotSupportedByThisBrowser")}
          </h2>
          <p className="text-muted-foreground text-sm">{wsError}</p>
          <p className="text-muted-foreground text-xs">
            {t("ui.useChromeOrEdge89OverHttpsOrLocalhost")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="border-border bg-muted/10 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-green-500" : "text-muted-foreground"}`}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-green-500" : "bg-slate-400"}`}
          />
          {connected
            ? t("dynamic.connectedBpsmessage13", { p0: config.baudRate })
            : t("ui.disconnected")}
        </span>
        <button
          onClick={() => setShowConfig((s) => !s)}
          className="border-border hover:bg-muted/50 text-muted-foreground flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
        >
          <Settings size={12} />
          {t("ui.configuration")}
          {showConfig ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        {!connected ? (
          <button
            onClick={connect}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm"
          >
            <Play size={13} />
            {t("ui.connectSerialPort")}
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-1.5 text-sm text-white hover:bg-red-600"
          >
            <Square size={13} />
            {t("ui.disconnect")}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={hexMode}
              onChange={(e) => setHexMode(e.target.checked)}
              className="accent-primary"
            />
            HEX
          </label>
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-primary"
            />
            {t("ui.autoScroll")}
          </label>
          <button
            onClick={downloadLog}
            title={t("ui.downloadLogs")}
            className="hover:bg-muted/50 text-muted-foreground rounded-lg p-1.5"
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => {
              allLines.current = [];
              setLines([]);
              setLogLines([]);
            }}
            title={t("ui.clear")}
            className="hover:bg-muted/50 text-muted-foreground rounded-lg p-1.5"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 串口配置展开 */}
      {showConfig && (
        <div className="bg-muted/20 border-border flex flex-wrap items-end gap-4 border-b px-4 py-3 text-sm">
          {[
            {
              label: t("ui.baudRate"),
              key: "baudRate",
              opts: BAUD_RATES.map((r) => ({ v: r, l: String(r) })),
            },
            {
              label: t("ui.dataBits"),
              key: "dataBits",
              opts: [
                { v: 8, l: "8" },
                { v: 7, l: "7" },
              ],
            },
            {
              label: t("ui.stopBits"),
              key: "stopBits",
              opts: [
                { v: 1, l: "1" },
                { v: 2, l: "2" },
              ],
            },
            {
              label: t("ui.parity"),
              key: "parity",
              opts: [
                { v: "none", l: t("ui.additionalNone") },
                { v: "even", l: "Even" },
                { v: "odd", l: "Odd" },
              ],
            },
            {
              label: t("ui.flowControl"),
              key: "flowControl",
              opts: [
                { v: "none", l: t("ui.additionalNone") },
                { v: "hardware", l: "Hardware" },
              ],
            },
          ].map((f) => (
            <div key={f.key}>
              <label className="text-muted-foreground mb-1 block text-xs">
                {f.label}
              </label>
              <select
                value={config[f.key as keyof SerialConfig]}
                disabled={connected}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    [f.key]: isNaN(Number(e.target.value))
                      ? e.target.value
                      : Number(e.target.value),
                  }))
                }
                className="border-border bg-background rounded-lg border px-2 py-1.5 text-sm focus:outline-none disabled:opacity-50"
              >
                {f.opts.map((o) => (
                  <option key={String(o.v)} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <label className="text-muted-foreground mb-1 block text-xs">
              {t("ui.lineEnding")}
            </label>
            <select
              value={lineEnding}
              onChange={(e) =>
                setLineEnding(e.target.value as typeof lineEnding)
              }
              className="border-border bg-background rounded-lg border px-2 py-1.5 text-sm focus:outline-none"
            >
              <option value="none">{t("ui.additionalNone")}</option>
              <option value="cr">CR (\r)</option>
              <option value="lf">LF (\n)</option>
              <option value="crlf">CRLF (\r\n)</option>
            </select>
          </div>
        </div>
      )}

      {/* 三栏：终端 | 日志管理 | 预制命令 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 终端 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className={`flex gap-2 ${lc(l.type)}`}>
                <span className="flex-shrink-0 text-slate-600 select-none">
                  [{l.ts}]
                </span>
                <span className="break-all whitespace-pre-wrap">
                  {l.text || "\u00A0"}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900 px-3 py-2">
            <span className="flex-shrink-0 font-mono text-sm text-cyan-400">
              TX
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!connected}
              placeholder={
                !connected
                  ? t("ui.connectASerialPortFirst")
                  : hexMode
                    ? t("ui.enterHexadecimalBytesEG0d0a")
                    : t("ui.enterTextEnterToSend")
              }
              className="flex-1 bg-transparent font-mono text-sm text-green-300 outline-none placeholder:text-slate-600 disabled:opacity-30"
            />
            <button
              onClick={() => send()}
              disabled={!connected || !input.trim()}
              className="bg-primary/20 hover:bg-primary/40 text-primary rounded-lg p-1.5 disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        {/* 日志管理侧栏 */}
        <LogSidePanel deviceType="serial" lines={logLines} />

        {/* 预制命令面板（右侧） */}
        <div className="border-border flex w-52 flex-shrink-0 flex-col overflow-hidden border-l">
          <PresetPanel
            deviceType="serial"
            onRun={(cmd) =>
              window.dispatchEvent(
                new CustomEvent("serial-preset-run", { detail: cmd }),
              )
            }
            disabled={!connected}
          />
        </div>
      </div>
    </div>
  );
}

// ── 日志管理侧栏（可折叠）─────────────────────────────────────
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
      className={`border-border bg-background flex-shrink-0 border-l transition-all duration-200 ${open ? "w-64" : "w-9"}`}
    >
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/30 flex h-full w-full flex-col items-center justify-start gap-2 pt-3 transition-colors"
        >
          <FileText size={15} />
          <span className="mt-2 text-xs [writing-mode:vertical-rl]">
            {t("ui.logManagement")}
          </span>
        </button>
      ) : (
        <div className="flex h-full flex-col overflow-hidden">
          <LogPanel deviceType={deviceType} lines={lines} />
        </div>
      )}
    </div>
  );
}
