"use client";

import { useEffect, useRef, useState } from "react";
import {
  Usb, Terminal, Activity, Play, Square,
  Download, Loader2, AlertTriangle, FileText,
} from "lucide-react";
import { AdbDevice, checkWebUsbSupport, type AdbStatus } from "@/lib/adb-webusb";
import PresetPanel from "@/components/debug/preset-panel";
import LogPanel    from "@/components/debug/log-panel";

type LineType = "sys" | "cmd" | "out" | "err";
interface Line { text: string; type: LineType; }

export default function AdbPage() {
  const [tab,    setTab]    = useState<"shell" | "logcat">("shell");
  const [status, setStatus] = useState<AdbStatus>("disconnected");
  const [errMsg, setErr]    = useState("");
  const [device, setDevice] = useState<AdbDevice | null>(null);
  const wsError = checkWebUsbSupport();

  // 各 tab 的日志行（供保存功能使用）
  const [shellLines,   setShellLines]  = useState<string[]>([]);
  const [logcatLines,  setLogcatLines] = useState<string[]>([]);

  async function connect() {
    setErr(""); setStatus("connecting");
    try {
      const dev = await AdbDevice.request();
      await dev.connect((s, msg) => { setStatus(s); if (msg) setErr(msg); });
      setDevice(dev); setStatus("connected");
    } catch (e: any) { setStatus("error"); setErr(e?.message ?? String(e)); }
  }

  async function disconnect() {
    await device?.disconnect();
    setDevice(null); setStatus("disconnected");
  }

  const statusBadge = () => {
    switch (status) {
      case "disconnected": return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="w-2 h-2 rounded-full bg-slate-400" />未连接</span>;
      case "connecting":   return <span className="flex items-center gap-1.5 text-xs text-yellow-500"><Loader2 size={12} className="animate-spin" />连接中...</span>;
      case "auth":         return <span className="flex items-center gap-1.5 text-xs text-amber-500"><span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />等待设备授权...</span>;
      case "connected":    return <span className="flex items-center gap-1.5 text-xs text-green-500"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />已连接</span>;
      case "error":        return <span className="flex items-center gap-1.5 text-xs text-red-500"><AlertTriangle size={12} />连接失败</span>;
    }
  };

  if (wsError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800
                        rounded-2xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle size={32} className="text-amber-500 mx-auto" />
          <h2 className="font-bold text-base">浏览器不支持 WebUSB</h2>
          <p className="text-sm text-muted-foreground">{wsError}</p>
          <p className="text-xs text-muted-foreground">请使用 Chrome 或 Edge 89+，并通过 HTTPS 或 localhost 访问</p>
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
          <span className={`text-xs truncate max-w-xs ${status === "error" ? "text-red-500" : "text-amber-600 dark:text-amber-400"}`}>{errMsg}</span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {status !== "connected" ? (
            <button onClick={connect} disabled={status === "connecting" || status === "auth"}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary
                         text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
              <Usb size={14} />
              {status === "connecting" || status === "auth" ? "连接中..." : "选择 USB 设备"}
            </button>
          ) : (
            <button onClick={disconnect}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm border border-border
                         rounded-lg hover:bg-muted/50 text-muted-foreground">
              断开连接
            </button>
          )}
        </div>
        <div className="flex border border-border rounded-lg overflow-hidden">
          {([["shell","Shell",<Terminal size={13} />],["logcat","Logcat",<Activity size={13} />]] as const).map(([k,l,icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}>
              {icon}{l}
            </button>
          ))}
        </div>
      </div>

      {/* 未连接提示 */}
      {status !== "connected" && (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground space-y-4">
          <Usb size={48} className="opacity-20" />
          <div className="text-center space-y-2 max-w-sm">
            <p className="font-medium">将安卓设备连接到此电脑</p>
            <ol className="text-sm text-left space-y-1 list-decimal list-inside">
              <li>在安卓设备上开启「开发者选项」→「USB 调试」</li>
              <li>用 USB 线连接设备到当前电脑</li>
              <li>点击「选择 USB 设备」在弹窗中选择你的设备</li>
              <li>首次连接需在设备屏幕点击「允许 USB 调试」</li>
            </ol>
          </div>
        </div>
      )}

      {/* 已连接：三栏布局（终端 | 日志 | 预制命令） */}
      {status === "connected" && device && (
        <div className="flex flex-1 overflow-hidden">
          {/* 中间：终端主体 */}
          <div className="flex-1 overflow-hidden min-w-0">
            {tab === "shell"
              ? <ShellTab  device={device} onLinesChange={setShellLines} />
              : <LogcatTab device={device} onLinesChange={setLogcatLines} />
            }
          </div>

          {/* 右侧：日志保存面板（折叠） */}
          <LogSidePanel deviceType="adb" lines={curLines} />

          {/* 最右：预制命令 */}
          <div className="w-52 flex-shrink-0 border-l border-border overflow-hidden flex flex-col">
            <PresetPanel
              deviceType="adb"
              onRun={cmd => {
                // 通过自定义事件传递命令给当前 tab
                window.dispatchEvent(new CustomEvent("adb-preset-run", { detail: cmd }));
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
function LogSidePanel({ deviceType, lines }: { deviceType: "adb"|"serial"; lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`flex-shrink-0 border-l border-border transition-all duration-200 ${open ? "w-64" : "w-9"}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full h-full flex flex-col items-center justify-start pt-3 gap-2
                   text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        title={open ? "收起日志面板" : "展开日志面板"}
      >
        {!open && (
          <>
            <FileText size={15} />
            <span className="text-xs [writing-mode:vertical-rl] mt-2">日志管理</span>
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-52 top-[calc(var(--topnav-h,48px)+40px)] w-64 h-[calc(100vh-88px)]
                        border-l border-border bg-background z-10 flex flex-col overflow-hidden">
          <LogPanel deviceType={deviceType} lines={lines} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Shell Tab
// ══════════════════════════════════════════════════════════════
function ShellTab({ device, onLinesChange }: { device: AdbDevice; onLinesChange: (l: string[]) => void }) {
  const [lines,   setLines]   = useState<Line[]>([{ text: "[FAE Shell] 连接成功，请输入命令", type: "sys" }]);
  const [input,   setInput]   = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [hidx,    setHidx]    = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const allText   = useRef<string[]>([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

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
    const newLines = text.split("\n").filter(l => l !== undefined).map(l => ({ text: l, type }));
    setLines(prev => [...prev, ...newLines]);
    allText.current.push(...newLines.map(l => l.text));
    onLinesChange([...allText.current]);
  }

  async function runCmd(cmd: string) {
    if (!cmd.trim() || running) return;
    setRunning(true); setHistory(h => [cmd, ...h.slice(0, 99)]); setHidx(-1);
    push(`$ ${cmd}`, "cmd");
    try {
      let out = "";
      await device.shell(cmd, txt => { out += txt; });
      push(out.trimEnd() || "(无输出)");
    } catch (e: any) { push(e?.message ?? "执行失败", "err"); }
    finally { setRunning(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")     { const c = input.trim(); if (c) { setInput(""); runCmd(c); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); const i = Math.min(hidx+1,history.length-1); setHidx(i); setInput(history[i]??""); }
    else if (e.key === "ArrowDown") { e.preventDefault(); const i = Math.max(hidx-1,-1); setHidx(i); setInput(i===-1?"":history[i]); }
  }

  function lineColor(t: LineType) {
    return { sys:"text-yellow-400", cmd:"text-cyan-400", out:"text-green-300", err:"text-red-400" }[t];
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {lines.map((l,i)=><div key={i} className={lineColor(l.type)}>{l.text||"\u00A0"}</div>)}
        {running && <div className="text-yellow-400 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin"/>执行中...</div>}
        <div ref={bottomRef}/>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-800 bg-slate-900">
        <span className="text-cyan-400 font-mono text-sm">$</span>
        <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKeyDown}
          disabled={running} autoFocus placeholder={running?"执行中...":"输入命令（Enter 执行，↑↓ 历史）"}
          className="flex-1 bg-transparent text-green-300 font-mono text-sm outline-none placeholder:text-slate-600 disabled:opacity-50"/>
        <button onClick={()=>{ setLines([{text:"终端已清空",type:"sys"}]); allText.current=[]; onLinesChange([]); }}
          className="text-xs text-slate-500 hover:text-slate-300">清空</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Logcat Tab
// ══════════════════════════════════════════════════════════════
function LogcatTab({ device, onLinesChange }: { device: AdbDevice; onLinesChange: (l: string[]) => void }) {
  const [running,    setRunning]   = useState(false);
  const [lines,      setLines]     = useState<string[]>([]);
  const [filter,     setFilter]    = useState("");
  const [autoScroll, setAutoScroll]= useState(true);
  const stopRef   = useRef<(()=>void)|null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const allLines  = useRef<string[]>([]);

  useEffect(()=>{ if(autoScroll) bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[lines,autoScroll]);

  async function start() {
    setLines([]); allLines.current=[]; setRunning(true);
    const stop = await device.startLogcat(line=>{
      allLines.current.push(line);
      if(allLines.current.length>3000) allLines.current=allLines.current.slice(-3000);
      setLines([...allLines.current]);
      onLinesChange([...allLines.current]);
    }, filter||undefined);
    stopRef.current=stop;
  }

  function stop(){ stopRef.current?.(); stopRef.current=null; setRunning(false); }

  function downloadLog(){
    const blob=new Blob([allLines.current.join("\n")],{type:"text/plain"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`logcat_${Date.now()}.txt`; a.click(); URL.revokeObjectURL(url);
  }

  function lc(l:string){
    if(/ [EF]\//.test(l)||/ E /.test(l)) return "text-red-400";
    if(/ W\//.test(l)||/ W /.test(l)) return "text-yellow-400";
    if(/ I\//.test(l)||/ I /.test(l)) return "text-green-400";
    if(/ D\//.test(l)||/ D /.test(l)) return "text-blue-400";
    return "text-slate-400";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-wrap bg-muted/10">
        <input value={filter} onChange={e=>setFilter(e.target.value)} disabled={running}
          placeholder="Tag 过滤（可选）"
          className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background
                     focus:outline-none focus:ring-2 focus:ring-primary/30 w-52 disabled:opacity-50"/>
        {!running
          ? <button onClick={start} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600"><Play size={13}/>开始拉取</button>
          : <button onClick={stop}  className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"><Square size={13}/>停止</button>
        }
        {running && <span className="flex items-center gap-1.5 text-sm text-green-500"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/>拉取中 · {lines.length} 行</span>}
        <div className="flex items-center gap-2 ml-auto">
          {lines.length>0 && <button onClick={downloadLog} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted/50 text-muted-foreground"><Download size={13}/>下载</button>}
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)} className="accent-primary"/>自动滚动
          </label>
          <button onClick={()=>{ setLines([]); allLines.current=[]; onLinesChange([]); }} className="text-sm text-muted-foreground hover:text-foreground">清空</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-950 font-mono text-xs p-4 leading-5">
        {lines.length===0
          ? <div className="flex flex-col items-center justify-center h-full text-slate-600"><Activity size={32} className="mb-2 opacity-40"/><p>点击"开始拉取"采集日志</p></div>
          : lines.map((l,i)=><div key={i} className={`whitespace-pre-wrap break-all ${lc(l)}`}>{l}</div>)
        }
        <div ref={bottomRef}/>
      </div>
    </div>
  );
}
