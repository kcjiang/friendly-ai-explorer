"use client";

import { Bot, ChevronDown, Loader2, Send } from "lucide-react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

export default function AiChatPanel() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "你好！我是 FAE AI 助手，可以帮你查询知识库、分析技术问题。有什么需要帮助的吗？",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || thinking) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setThinking(true);

    // 先插入一条 loading 的 assistant 消息
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", loading: true },
    ]);

    try {
      const token = session?.accessToken;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/v1/ai/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: text }),
        },
      );

      if (!res.ok || !res.body) throw new Error("请求失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let finished = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data === "[DONE]") { finished = true; break; }
          if (data) {
            const chunk: { text?: string; error?: string } = JSON.parse(data);
            if (chunk.error) accumulated += `\n\n[错误] ${chunk.error}`;
            else accumulated += chunk.text ?? "";
          }
          boundary = buffer.indexOf("\n\n");
        }

        // 实时更新最后一条 assistant 消息
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: accumulated };
          return next;
        });
        if (finished) { await reader.cancel(); break; }
      }
      reader.releaseLock();
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: "抱歉，请求出现错误，请稍后重试。",
        };
        return next;
      });
    } finally {
      setThinking(false);
    }
  }

  return (
    <>
      {/* 浮动按钮 */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`fixed bottom-6 right-6 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 via-indigo-400 to-violet-500 p-0.5 shadow-lg shadow-indigo-500/20 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-indigo-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none ${
          open ? "pointer-events-none scale-90 opacity-0" : ""
        }`}
        title="AI 助手"
        aria-label="打开 AI 助手"
        aria-expanded={open}
        aria-controls="fae-ai-chat-panel"
        tabIndex={open ? -1 : 0}
      >
        <span className="relative h-full w-full overflow-hidden rounded-full bg-indigo-50 dark:bg-slate-900">
          <Image
            src="/cedar.gif"
            alt=""
            width={64}
            height={64}
            unoptimized
            className="h-full w-full -translate-y-[10%] scale-[1.35] object-contain"
          />
        </span>
      </button>

      {/* 聊天面板 */}
      <div
        id="fae-ai-chat-panel"
        className={`fixed bottom-6 right-6 z-50 flex w-96 origin-bottom-right flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl transition-all duration-300 ${
          open
            ? "max-h-[600px] scale-100 opacity-100"
            : "pointer-events-none max-h-0 scale-90 opacity-0"
        }`}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-white" />
            <span className="text-sm font-semibold text-white">
              FAE AI 助手
            </span>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-white/70 transition-colors hover:text-white"
          >
            <ChevronDown size={18} />
          </button>
        </div>

        {/* 消息列表 */}
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
          style={{ maxHeight: 440 }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              {/* 头像 */}
              {msg.role === "assistant" ? (
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600">
                  <Bot size={14} className="text-white" />
                </div>
              ) : (
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}

              {/* 气泡 */}
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-tl-sm bg-muted"
                }`}
              >
                {msg.loading ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" />
                    思考中...
                  </span>
                ) : (
                  <MarkdownText content={msg.content} />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-border px-3 py-3">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="输入问题... (Enter 发送)"
            disabled={thinking}
            className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={thinking || !input.trim()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {thinking ? (
              <Loader2 size={15} className="animate-spin text-white" />
            ) : (
              <Send size={15} className="text-white" />
            )}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 简易 Markdown 渲染（仅处理常用格式）────────────────────────
function MarkdownText({ content }: { content: string }) {
  if (!content) return null;

  // 将 **bold** 转为 <strong>，`code` 转为 <code>，## 标题转为 <strong>
  const lines = content.split("\n");
  return (
    <div className="space-y-1 whitespace-pre-wrap break-words">
      {lines.map((line, i) => {
        // 标题行
        if (line.startsWith("## ")) {
          return (
            <p key={i} className="mt-2 font-semibold">
              {line.slice(3)}
            </p>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <p key={i} className="mt-2 font-bold">
              {line.slice(2)}
            </p>
          );
        }
        // 列表项
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <p key={i} className="pl-3">
              • {renderInline(line.slice(2))}
            </p>
          );
        }
        // 数字列表
        if (/^\d+\.\s/.test(line)) {
          return (
            <p key={i} className="pl-3">
              {renderInline(line)}
            </p>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // 处理 **bold** 和 `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
