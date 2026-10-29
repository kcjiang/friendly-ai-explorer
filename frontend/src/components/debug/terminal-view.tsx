"use client";

import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Pause,
  Search,
  X,
} from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import type { IDisposable, IMarker, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import type { DeviceSession } from "@/lib/device-session";
import {
  terminalFonts,
  terminalPreferences,
  terminalThemes,
  useTerminalPreferences,
} from "@/lib/terminal-preferences";
import TerminalPasteDialog, {
  type PasteRequest,
} from "./terminal-paste-dialog";
import TerminalSettings from "./terminal-settings";

export default function TerminalView({
  session,
  report,
  overlayActions = false,
}: {
  session: DeviceSession;
  report: (error: unknown) => void;
  overlayActions?: boolean;
}) {
  const zh = useLocale() === "zh-CN";
  const preferences = useTerminalPreferences();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | undefined>(undefined);
  const search = useRef<SearchAddon | undefined>(undefined);
  const searchInput = useRef<HTMLInputElement>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const following = useRef(true);
  const navigated = useRef(false);
  const [follow, setFollow] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState("");
  const [catchingUp, setCatchingUp] = useState(false);
  const [paste, setPaste] = useState<PasteRequest | null>(null);
  const openPaste = (text: string) =>
    setPaste({
      id: crypto.randomUUID(),
      text,
      token: session.connectionToken(),
      bracketed: term.current?.modes.bracketedPasteMode === true,
    });
  const followRef = useRef((value: boolean) => {
    following.current = value;
    setFollow(value);
  });
  const find = (previous = false) => {
    if (!query || !search.current) return;
    try {
      if (regex) new RegExp(query);
      followRef.current(false);
      navigated.current = true;
      const found = search.current[previous ? "findPrevious" : "findNext"](
        query,
        {
          regex,
          caseSensitive,
          decorations: {
            matchBackground: "#854d0e",
            activeMatchBackground: "#a16207",
            matchOverviewRuler: "#eab308",
            activeMatchColorOverviewRuler: "#f97316",
          },
        },
      );
      if (!found) setResult(zh ? "未找到" : "No matches");
    } catch {
      setResult(zh ? "正则表达式无效" : "Invalid regular expression");
    }
  };
  useEffect(() => {
    if (!searchOpen) {
      search.current?.clearDecorations();
      setResult("");
      return;
    }
    searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    search.current?.clearDecorations();
    setResult("");
  }, [query, regex, caseSensitive]);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    followRef.current(true);
    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-search"),
    ])
      .then(([{ Terminal }, { FitAddon }, { SearchAddon }]) => {
        if (disposed || !host.current) return;
        const p = terminalPreferences.snapshot();
        const terminal = new Terminal({
          disableStdin: session.snapshot().status !== "connected",
          cursorBlink: true,
          fontSize: p.fontSize,
          fontFamily: terminalFonts[p.font],
          lineHeight: p.lineHeight,
          cursorStyle: p.cursor,
          theme: terminalThemes[p.theme],
          scrollback: 10000,
          scrollOnUserInput: false,
          allowProposedApi: true,
        });
        term.current = terminal;
        const fit = new FitAddon();
        const finder = new SearchAddon({ highlightLimit: 1000 });
        terminal.loadAddon(fit);
        terminal.loadAddon(finder);
        search.current = finder;
        terminal.open(host.current);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let resizeFrame = 0;
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        let highlightTimer: ReturnType<typeof setTimeout> | undefined;
        let pending = session.transcript;
        let reset = false;
        let writing = false;
        let marked: (IDisposable | IMarker)[] = [];
        const clearMarks = () => {
          marked.forEach((mark) => mark.dispose());
          marked = [];
        };
        const markKeywords = () => {
          clearMarks();
          if (disposed || !terminalPreferences.snapshot().highlight) return;
          const buffer = terminal.buffer.active;
          for (
            let y = buffer.viewportY;
            y < Math.min(buffer.length, buffer.viewportY + terminal.rows);
            y++
          ) {
            const line = buffer.getLine(y);
            if (!line) continue;
            const content = line.translateToString(true);
            const matches = [
              ...content.matchAll(/\b(ERROR|FATAL|WARN(?:ING)?)\b/gi),
            ];
            if (!matches.length) continue;
            let offset = 0;
            const columns: number[] = [];
            for (let x = 0; x < line.length; x++) {
              const cell = line.getCell(x);
              if (!cell || cell.getWidth() === 0) continue;
              const chars = cell.getChars() || " ";
              for (let k = 0; k < chars.length; k++) columns[offset++] = x;
            }
            for (const match of matches.slice(0, 20)) {
              const marker = terminal.registerMarker(
                y - buffer.baseY - buffer.cursorY,
              );
              if (!marker) continue;
              marked.push(marker);
              const decoration = terminal.registerDecoration({
                marker,
                x: columns[match.index!] || 0,
                width: match[0].length,
                layer: "top",
              });
              if (decoration) {
                marked.push(decoration);
                decoration.onRender((element) => {
                  element.style.borderBottom =
                    "2px solid " +
                    (/^WARN/i.test(match[0]) ? "#eab308" : "#ef4444");
                });
              }
            }
          }
        };
        const scheduleMarks = () => {
          if (!highlightTimer)
            highlightTimer = setTimeout(() => {
              highlightTimer = undefined;
              markKeywords();
            }, 200);
        };
        const pump = () => {
          timer = undefined;
          if (disposed || writing || !pending) return;
          writing = true;
          if (reset) {
            terminal.reset();
            reset = false;
            clearMarks();
          }
          let end = Math.min(pending.length, 32768);
          if (end < pending.length && /[\uD800-\uDBFF]/.test(pending[end - 1]))
            end--;
          const data = pending.slice(0, end);
          pending = pending.slice(end);
          const buffer = terminal.buffer.active;
          const marker = !following.current
            ? terminal.registerMarker(
                buffer.viewportY - buffer.baseY - buffer.cursorY,
              )
            : undefined;
          navigated.current = false;
          terminal.write(data, () => {
            writing = false;
            if (disposed) return;
            if (following.current) terminal.scrollToBottom();
            else if (!navigated.current && marker)
              terminal.scrollToLine(Math.max(0, marker.line));
            marker?.dispose();
            scheduleMarks();
            if (pending) timer = setTimeout(pump, 0);
          });
        };
        const unsubscribe = session.receive((data, clear) => {
          if (clear) {
            pending = data;
            reset = true;
            followRef.current(true);
            finder.clearDecorations();
          } else pending += data;
          if (pending.length > 500000) {
            // Rendering may catch up to the tail; the separate recorder sees all output.
            pending = session.transcript;
            reset = true;
            setCatchingUp(true);
          }
          if (!writing && !timer) timer = setTimeout(pump, 16);
        });
        const stateUnsubscribe = session.subscribe(() => {
          terminal.options.disableStdin =
            session.snapshot().status !== "connected" ||
            session.snapshot().pasting;
        });
        const terminalResize = terminal.onResize(({ cols, rows }) => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            void session.resize(cols, rows).catch((e) => reportRef.current(e));
          }, 100);
        });
        const input = terminal.onData((data) => {
          void session.write(data).catch((e) => reportRef.current(e));
        });
        const scrolling = terminal.onScroll(() => {
          if (!writing)
            followRef.current(
              terminal.buffer.active.viewportY >= terminal.buffer.active.baseY,
            );
          scheduleMarks();
        });
        const wheel = (event: WheelEvent) => {
          navigated.current = true;
          if (event.deltaY < 0) followRef.current(false);
        };
        const pointer = (event: PointerEvent) => {
          if ((event.target as HTMLElement).closest(".xterm-viewport")) {
            navigated.current = true;
            followRef.current(false);
          }
        };
        host.current.addEventListener("wheel", wheel, { passive: true });
        host.current.addEventListener("pointerdown", pointer);
        const searchResults = finder.onDidChangeResults(
          ({ resultCount, resultIndex }) =>
            setResult(
              (resultIndex >= 0 ? resultIndex + 1 : "—") + " / " + resultCount,
            ),
        );
        const fitTerminal = () => {
          if (
            disposed ||
            !host.current?.clientWidth ||
            !host.current?.clientHeight
          )
            return;
          try {
            fit.fit();
          } catch (error) {
            reportRef.current(error);
          }
          scheduleMarks();
        };
        const prefsUnsubscribe = terminalPreferences.subscribe(() => {
          const next = terminalPreferences.snapshot();
          terminal.options.fontSize = next.fontSize;
          terminal.options.fontFamily = terminalFonts[next.font];
          terminal.options.lineHeight = next.lineHeight;
          terminal.options.cursorStyle = next.cursor;
          terminal.options.theme = terminalThemes[next.theme];
          fitTerminal();
        });
        const resize = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(fitTerminal);
        });
        resize.observe(host.current);
        fitTerminal();
        timer = setTimeout(pump, 0);
        cleanup = () => {
          clearTimeout(timer);
          clearTimeout(highlightTimer);
          clearTimeout(resizeTimer);
          cancelAnimationFrame(resizeFrame);
          resize.disconnect();
          host.current?.removeEventListener("wheel", wheel);
          host.current?.removeEventListener("pointerdown", pointer);
          input.dispose();
          terminalResize.dispose();
          scrolling.dispose();
          searchResults.dispose();
          clearMarks();
          unsubscribe();
          stateUnsubscribe();
          prefsUnsubscribe();
          terminal.dispose();
          if (term.current === terminal) {
            term.current = undefined;
            search.current = undefined;
          }
        };
      })
      .catch((error) => reportRef.current(error));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [session]);
  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col"
      style={{ backgroundColor: terminalThemes[preferences.theme].background }}
      onPasteCapture={(e) => {
        if (!(e.target as HTMLElement).closest(".xterm")) return;
        const text = e.clipboardData.getData("text/plain");
        if (
          text.length > 128 ||
          Array.from(text).some((char) => {
            const code = char.charCodeAt(0);
            return code < 32 || (code >= 127 && code <= 159);
          })
        ) {
          e.preventDefault();
          e.stopPropagation();
          openPaste(text);
        }
      }}
      onKeyDownCapture={(e) => {
        if (e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey)) return;
        if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          setSearchOpen(true);
        }
        if (["+", "=", "-", "0"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          terminalPreferences.set({
            fontSize:
              e.key === "0"
                ? 13
                : terminalPreferences.snapshot().fontSize +
                  (e.key === "-" ? -1 : 1),
          });
        }
      }}
    >
      <div
        className={`bg-background flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 text-xs ${overlayActions ? "pr-44" : ""}`}
      >
        <TerminalSettings />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={zh ? "粘贴预览" : "Preview paste"}
          title={zh ? "粘贴预览" : "Preview paste"}
          onClick={() => openPaste("")}
        >
          <ClipboardPaste />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={zh ? "搜索输出" : "Search output"}
          title={zh ? "搜索输出（Ctrl/⌘+F）" : "Search output (Ctrl/⌘+F)"}
          onClick={() => setSearchOpen((v) => !v)}
        >
          <Search />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={
            follow
              ? zh
                ? "暂停自动滚动"
                : "Pause auto-scroll"
              : zh
                ? "回到底部并跟随"
                : "Follow latest output"
          }
          title={
            zh
              ? "暂停滚动不影响接收和记录"
              : "Pausing scrolling keeps receiving and recording"
          }
          onClick={() => {
            followRef.current(!following.current);
            if (following.current) term.current?.scrollToBottom();
          }}
        >
          {follow ? <Pause /> : <ArrowDown />}
        </Button>
        {!follow && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              followRef.current(true);
              term.current?.scrollToBottom();
            }}
          >
            {zh ? "回到底部" : "Latest"}
          </Button>
        )}
        {catchingUp && (
          <button
            className="text-muted-foreground max-w-52 text-left"
            onClick={() => setCatchingUp(false)}
          >
            {zh
              ? "输出过快，显示已追到最新内容；记录不受影响。"
              : "Display caught up; recording is unaffected."}
          </button>
        )}
      </div>
      {searchOpen && (
        <form
          className="bg-background flex shrink-0 flex-wrap items-center gap-1 border-b p-1 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <Input
            ref={searchInput}
            className="h-7 min-w-24 flex-1"
            aria-label={zh ? "搜索终端回滚内容" : "Search terminal scrollback"}
            placeholder={zh ? "搜索最近 10,000 行" : "Search last 10,000 lines"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                find(true);
              }
            }}
          />
          <Button
            variant={caseSensitive ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={caseSensitive}
            type="button"
            title={zh ? "区分大小写" : "Match case"}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </Button>
          <Button
            variant={regex ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={regex}
            type="button"
            title={zh ? "正则表达式" : "Regular expression"}
            onClick={() => setRegex((v) => !v)}
          >
            .*
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={zh ? "上一个匹配" : "Previous match"}
            onClick={() => find(true)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="submit"
            aria-label={zh ? "下一个匹配" : "Next match"}
          >
            <ChevronDown />
          </Button>
          <span role="status">{result}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={zh ? "关闭搜索" : "Close search"}
            onClick={() => setSearchOpen(false)}
          >
            <X />
          </Button>
        </form>
      )}
      <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-hidden p-2" />
      {paste && (
        <TerminalPasteDialog
          key={paste.id}
          session={session}
          request={paste}
          onClose={() => setPaste(null)}
        />
      )}
    </div>
  );
}
