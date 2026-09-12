"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Bot, X, Send, Loader2, ChevronDown } from "lucide-react";

interface Message {
  role:    "user" | "assistant";
  content: string;
  loading?: boolean;
}

export default function AiChatPanel() {
  const { data: session } = useSession();
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "你好！我是 FAE AI 助手，可以帮你查询知识库、分析技术问题。有什么需要帮助的吗？" },
  ]);
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

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
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setThinking(true);

    // 先插入一条 loading 的 assistant 消息
    setMessages(prev => [...prev, { role: "assistant", content: "", loading: true }]);

    try {
      const token = session?.accessToken;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/ai/chat`,
        {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ message: text }),
        }
      );

      if (!res.ok || !res.body) throw new Error("请求失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        // SSE 格式解析：每行 "data: <内容>"
        const lines = raw.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const chunk = line.slice(6);
          if (chunk === "[DONE]") break;
          if (chunk.startsWith("[错误]")) {
            accumulated = chunk;
            break;
          }
          accumulated += chunk;
        }

        // 实时更新最后一条 assistant 消息
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: accumulated };
          return next;
        });
      }
    } catch (e) {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = {
          role:    "assistant",
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
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-lg
                    flex items-center justify-center transition-all duration-300
                    bg-gradient-to-br from-blue-500 to-violet-600
                    hover:scale-110 hover:shadow-blue-500/30 hover:shadow-xl ${
                      open ? "scale-90 opacity-0 pointer-events-none" : ""
                    }`}
        title="AI 助手"
      >
        <Bot size={22} className="text-white" />
      </button>

      {/* 聊天面板 */}
      <div
        className={`fixed bottom-6 right-6 z-50 w-96 flex flex-col rounded-2xl shadow-2xl
                    border border-border bg-background overflow-hidden
                    transition-all duration-300 origin-bottom-right ${
                      open
                        ? "opacity-100 scale-100 max-h-[600px]"
                        : "opacity-0 scale-90 max-h-0 pointer-events-none"
                    }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3
                        bg-gradient-to-r from-blue-500 to-violet-600 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-white" />
            <span className="text-sm font-semibold text-white">FAE AI 助手</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-white/70 hover:text-white transition-colors"
          >
            <ChevronDown size={18} />
          </button>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0" style={{ maxHeight: 440 }}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              {/* 头像 */}
              {msg.role === "assistant" ? (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600
                                flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot size={14} className="text-white" />
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center
                                flex-shrink-0 mt-0.5 text-xs font-semibold text-primary">
                  {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}

              {/* 气泡 */}
              <div
                className={`max-w-[75%] px-3 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
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
        <div className="flex items-center gap-2 px-3 py-3 border-t border-border flex-shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="输入问题... (Enter 发送)"
            disabled={thinking}
            className="flex-1 px-3 py-2 text-sm rounded-xl border border-border bg-muted/30
                       focus:outline-none focus:ring-2 focus:ring-primary/30
                       disabled:opacity-50 transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={thinking || !input.trim()}
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600
                       flex items-center justify-center flex-shrink-0
                       hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {thinking
              ? <Loader2 size={15} className="text-white animate-spin" />
              : <Send size={15} className="text-white" />
            }
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
          return <p key={i} className="font-semibold mt-2">{line.slice(3)}</p>;
        }
        if (line.startsWith("# ")) {
          return <p key={i} className="font-bold mt-2">{line.slice(2)}</p>;
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
          return <p key={i} className="pl-3">{renderInline(line)}</p>;
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
        <code key={i} className="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
