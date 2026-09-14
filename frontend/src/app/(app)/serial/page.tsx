"use client";

import { errorMessage } from "@/lib/errors";

import { useEffect, useRef, useState } from "react";
import {
  Cable, Send, Trash2, Download, Settings,
  Play, Square, AlertTriangle, ChevronDown, ChevronUp, FileText,
} from "lucide-react";
import { checkWebSerialSupport } from "@/lib/adb-webusb";
import PresetPanel from "@/components/debug/preset-panel";
import LogPanel    from "@/components/debug/log-panel";

interface SerialConfig {
  baudRate:    number;
  dataBits:    7 | 8;
  stopBits:    1 | 2;
  parity:      "none" | "even" | "odd";
  flowControl: "none" | "hardware";
}

const DEFAULT_CONFIG: SerialConfig = { baudRate:115200, dataBits:8, stopBits:1, parity:"none", flowControl:"none" };
const BAUD_RATES = [9600,19200,38400,57600,115200,230400,460800,921600];

type LineType = "sys" | "tx" | "rx" | "err";
interface Line { text:string; type:LineType; ts:string; }
function now(){ return new Date().toLocaleTimeString("zh-CN",{hour12:false}); }
function lc(t:LineType){ return {sys:"text-yellow-400",tx:"text-cyan-400",rx:"text-green-300",err:"text-red-400"}[t]; }

export default function SerialPage() {
  const [config,      setConfig]     = useState<SerialConfig>(DEFAULT_CONFIG);
  const [showConfig,  setShowConfig] = useState(false);
  const [connected,   setConnected]  = useState(false);
  const [lines,       setLines]      = useState<Line[]>([{text:"欢迎使用 FAE 串口调试工具",type:"sys",ts:now()}]);
  const [input,       setInput]      = useState("");
  const [hexMode,     setHexMode]    = useState(false);
  const [lineEnding,  setLineEnding] = useState<"none"|"cr"|"lf"|"crlf">("crlf");
  const [autoScroll,  setAutoScroll] = useState(true);
  const [history,     setHistory]    = useState<string[]>([]);
  const [hidx,        setHidx]       = useState(-1);
  const [logLines,    setLogLines]   = useState<string[]>([]);

  const portRef   = useRef<SerialPort|null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array>|null>(null);
  const stopRef   = useRef(false);
  const allLines  = useRef<Line[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const wsError = checkWebSerialSupport();

  useEffect(()=>{ if(autoScroll) bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[lines,autoScroll]);

  // 监听预制命令事件
  useEffect(()=>{
    const handler=(e:Event)=>{ const cmd=(e as CustomEvent).detail as string; if(cmd) sendRaw(cmd); };
    window.addEventListener("serial-preset-run",handler);
    return ()=>window.removeEventListener("serial-preset-run",handler);
  },[connected]);

  function push(text:string, type:LineType){
    const line:Line={text,type,ts:now()};
    allLines.current.push(line);
    if(allLines.current.length>5000) allLines.current=allLines.current.slice(-5000);
    setLines([...allLines.current]);
    setLogLines(allLines.current.map(l=>`[${l.ts}][${l.type.toUpperCase()}] ${l.text}`));
  }

  async function connect(){
    try{
      const port=await navigator.serial.requestPort();
      await port.open({baudRate:config.baudRate,dataBits:config.dataBits,stopBits:config.stopBits,parity:config.parity,flowControl:config.flowControl});
      portRef.current=port; writerRef.current=port.writable!.getWriter();
      stopRef.current=false; setConnected(true);
      push(`已连接 · ${config.baudRate} bps · ${config.dataBits}${config.parity[0].toUpperCase()}${config.stopBits}`,"sys");
      void readLoop(port);
    }catch (e: unknown){ push(`连接失败：${errorMessage(e, String(e))}`,"err"); }
  }

  async function readLoop(port:SerialPort){
    const td=new TextDecoder();
    try{
      while(!stopRef.current&&port.readable){
        const reader=port.readable.getReader();
        try{
          while(!stopRef.current){
            const{value,done}=await reader.read();
            if(done||stopRef.current) break;
            if(!value) continue;
            if(hexMode){
              push(Array.from(value).map(b=>b.toString(16).toUpperCase().padStart(2,"0")).join(" "),"rx");
            }else{
              const text=td.decode(value,{stream:true});
              const parts=text.split(/\r?\n/);
              for(let i=0;i<parts.length-1;i++) push(parts[i],"rx");
              if(parts[parts.length-1]) push(parts[parts.length-1],"rx");
            }
          }
        }finally{ reader.releaseLock(); }
      }
    }catch (e: unknown){ if(!stopRef.current) push(`读取错误：${errorMessage(e, String(e))}`,"err"); }
  }

  async function disconnect(){
    stopRef.current=true;
    try{ writerRef.current?.releaseLock(); }catch { /* The device may already be disconnected. */ }
    try{ await portRef.current?.close(); }catch { /* The device may already be disconnected. */ }
    portRef.current=null; writerRef.current=null;
    setConnected(false); push("已断开连接","sys");
  }

  async function sendRaw(raw:string){
    if(!writerRef.current) return;
    const data=new TextEncoder().encode(raw);
    try{
      await writerRef.current.write(data);
      push(`→ ${raw.replace(/\r/g,"\\r").replace(/\n/g,"\\n")}`,"tx");
    }catch (e: unknown){ push(`发送失败：${errorMessage(e, String(e))}`,"err"); }
  }

  async function send(raw?:string){
    const text=raw??input;
    if(!text||!writerRef.current) return;
    let data:Uint8Array;
    if(hexMode&&!raw){
      const bytes=text.trim().split(/\s+/).map(h=>parseInt(h,16)).filter(n=>!isNaN(n));
      data=new Uint8Array(bytes);
    }else{
      let s=text;
      if(!raw){ switch(lineEnding){ case"cr":s+="\r";break;case"lf":s+="\n";break;case"crlf":s+="\r\n";break; } }
      data=new TextEncoder().encode(s);
    }
    try{
      await writerRef.current.write(data);
      push(`→ ${(raw??text).replace(/\r/g,"\\r").replace(/\n/g,"\\n")}`,"tx");
      if(!raw){ setHistory(h=>[text,...h.slice(0,99)]); setHidx(-1); setInput(""); }
    }catch (e: unknown){ push(`发送失败：${errorMessage(e, String(e))}`,"err"); }
  }

  function onKeyDown(e:React.KeyboardEvent<HTMLInputElement>){
    if(e.key==="Enter"){ send(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); const i=Math.min(hidx+1,history.length-1); setHidx(i); setInput(history[i]??""); }
    else if(e.key==="ArrowDown"){ e.preventDefault(); const i=Math.max(hidx-1,-1); setHidx(i); setInput(i===-1?"":history[i]); }
  }

  function downloadLog(){
    const blob=new Blob([logLines.join("\n")],{type:"text/plain"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`serial_${Date.now()}.txt`; a.click(); URL.revokeObjectURL(url);
  }

  if(wsError){
    return(
      <div className="flex items-center justify-center h-full p-8">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle size={32} className="text-amber-500 mx-auto"/>
          <h2 className="font-bold text-base">浏览器不支持 Web Serial</h2>
          <p className="text-sm text-muted-foreground">{wsError}</p>
          <p className="text-xs text-muted-foreground">请使用 Chrome 或 Edge 89+，通过 HTTPS 或 localhost 访问</p>
        </div>
      </div>
    );
  }

  return(
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-wrap bg-muted/10">
        <span className={`flex items-center gap-1.5 text-xs font-medium ${connected?"text-green-500":"text-muted-foreground"}`}>
          <span className={`w-2 h-2 rounded-full ${connected?"bg-green-500 animate-pulse":"bg-slate-400"}`}/>
          {connected?`已连接 · ${config.baudRate} bps`:"未连接"}
        </span>
        <button onClick={()=>setShowConfig(s=>!s)}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-border rounded-lg hover:bg-muted/50 text-muted-foreground">
          <Settings size={12}/>配置{showConfig?<ChevronUp size={11}/>:<ChevronDown size={11}/>}
        </button>
        {!connected
          ? <button onClick={connect} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"><Play size={13}/>连接串口</button>
          : <button onClick={disconnect} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"><Square size={13}/>断开</button>
        }
        <div className="flex items-center gap-3 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={hexMode} onChange={e=>setHexMode(e.target.checked)} className="accent-primary"/>HEX
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)} className="accent-primary"/>自动滚动
          </label>
          <button onClick={downloadLog} title="下载日志" className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
            <Download size={14}/>
          </button>
          <button onClick={()=>{ allLines.current=[]; setLines([]); setLogLines([]); }} title="清空" className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
            <Trash2 size={14}/>
          </button>
        </div>
      </div>

      {/* 串口配置展开 */}
      {showConfig&&(
        <div className="flex flex-wrap items-end gap-4 px-4 py-3 bg-muted/20 border-b border-border text-sm">
          {[
            {label:"波特率",key:"baudRate",opts:BAUD_RATES.map(r=>({v:r,l:String(r)}))},
            {label:"数据位",key:"dataBits",opts:[{v:8,l:"8"},{v:7,l:"7"}]},
            {label:"停止位",key:"stopBits",opts:[{v:1,l:"1"},{v:2,l:"2"}]},
            {label:"校验位",key:"parity",opts:[{v:"none",l:"None"},{v:"even",l:"Even"},{v:"odd",l:"Odd"}]},
            {label:"流控",key:"flowControl",opts:[{v:"none",l:"None"},{v:"hardware",l:"Hardware"}]},
          ].map(f=>(
            <div key={f.key}>
              <label className="block text-xs text-muted-foreground mb-1">{f.label}</label>
              <select value={config[f.key as keyof SerialConfig]} disabled={connected}
                onChange={e=>setConfig(c=>({...c,[f.key]:isNaN(Number(e.target.value))?e.target.value:Number(e.target.value)}))}
                className="px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none disabled:opacity-50">
                {f.opts.map(o=><option key={String(o.v)} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">行尾</label>
            <select value={lineEnding} onChange={e=>setLineEnding(e.target.value as typeof lineEnding)}
              className="px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none">
              <option value="none">None</option>
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
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 min-w-0">
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
            {lines.map((l,i)=>(
              <div key={i} className={`flex gap-2 ${lc(l.type)}`}>
                <span className="text-slate-600 flex-shrink-0 select-none">[{l.ts}]</span>
                <span className="break-all whitespace-pre-wrap">{l.text||"\u00A0"}</span>
              </div>
            ))}
            <div ref={bottomRef}/>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-800 bg-slate-900">
            <span className="text-cyan-400 font-mono text-sm flex-shrink-0">TX</span>
            <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKeyDown}
              disabled={!connected}
              placeholder={!connected?"请先连接串口...":hexMode?"输入十六进制（如：0D 0A）":"输入内容（Enter 发送）"}
              className="flex-1 bg-transparent text-green-300 font-mono text-sm outline-none placeholder:text-slate-600 disabled:opacity-30"/>
            <button onClick={()=>send()} disabled={!connected||!input.trim()}
              className="p-1.5 rounded-lg bg-primary/20 hover:bg-primary/40 text-primary disabled:opacity-30">
              <Send size={14}/>
            </button>
          </div>
        </div>

        {/* 日志管理侧栏 */}
        <LogSidePanel deviceType="serial" lines={logLines}/>

        {/* 预制命令面板（右侧） */}
        <div className="w-52 flex-shrink-0 border-l border-border overflow-hidden flex flex-col">
          <PresetPanel
            deviceType="serial"
            onRun={cmd=>window.dispatchEvent(new CustomEvent("serial-preset-run",{detail:cmd}))}
            disabled={!connected}
          />
        </div>
      </div>
    </div>
  );
}

// ── 日志管理侧栏（可折叠）─────────────────────────────────────
function LogSidePanel({ deviceType, lines }: { deviceType:"adb"|"serial"; lines:string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`flex-shrink-0 border-l border-border bg-background transition-all duration-200 ${open?"w-64":"w-9"}`}>
      {!open ? (
        <button onClick={()=>setOpen(true)}
          className="w-full h-full flex flex-col items-center justify-start pt-3 gap-2
                     text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
          <FileText size={15}/>
          <span className="text-xs [writing-mode:vertical-rl] mt-2">日志管理</span>
        </button>
      ) : (
        <div className="flex flex-col h-full overflow-hidden">
          <LogPanel deviceType={deviceType} lines={lines} onClose={()=>setOpen(false)}/>
        </div>
      )}
    </div>
  );
}
