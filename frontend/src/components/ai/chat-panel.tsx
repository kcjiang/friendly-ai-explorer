"use client";

import { Bot, ChevronDown, Loader2, Send, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";

interface Message {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
  failed?: boolean;
}

export default function AiChatPanel() {
  const locale = useLocale();
  const t = useUiTranslations();

  const { data: session } = useSession();
  const pathname = usePathname();
  const pathSection = pathname.split("/")[1] || "dashboard";
  const section =
    pathSection === "ticket"
      ? "tickets"
      : ["adb", "serial"].includes(pathSection)
        ? "debug"
        : pathSection;
  const page = [
    "dashboard",
    "tickets",
    "knowledge",
    "email",
    "debug",
    "catalog",
    "admin",
  ].includes(section)
    ? section
    : "other";
  const pageNames: Record<string, string> = {
    dashboard: t("ui.workbench"),
    tickets: t("ui.tickets"),
    knowledge: t("ui.knowledgeBase"),
    email: t("ui.mail"),
    debug: t("ui.debugging"),
    catalog: t("ui.catalog"),
    admin: t("ui.administration"),
    other: t("ui.currentPage"),
  };
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: t("ui.helloIAmYourFaeAiAssistantICanChatSearchThe"),
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
    const history: { role: "user" | "assistant"; content: string }[] = [];
    let budget = 16000;
    for (let i = messages.length - 2; i >= 1 && history.length < 10; i -= 2) {
      const user = messages[i],
        assistant = messages[i + 1];
      if (
        user.role !== "user" ||
        assistant.role !== "assistant" ||
        assistant.failed ||
        assistant.loading ||
        !assistant.content
      )
        continue;
      const pair = [
        { role: "user" as const, content: user.content.slice(0, 4000) },
        {
          role: "assistant" as const,
          content: assistant.content.slice(0, 4000),
        },
      ];
      const size = pair[0].content.length + pair[1].content.length;
      if (size > budget) break;
      history.unshift(...pair);
      budget -= size;
    }

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
            "X-FAE-Locale": locale,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: text, history, page }),
        },
      );

      if (!res.ok || !res.body) throw new Error(t("ui.requestFailed"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let finished = false;
      let failed = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data === "[DONE]") {
            finished = true;
            break;
          }
          if (data) {
            const chunk: { text?: string; error?: string } = JSON.parse(data);
            if (chunk.error) {
              failed = true;
              accumulated += t("dynamic.error", {
                p0: systemMessage(chunk.error, t),
              });
            } else accumulated += chunk.text ?? "";
          }
          boundary = buffer.indexOf("\n\n");
        }

        // 实时更新最后一条 assistant 消息
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: accumulated,
            failed,
          };
          return next;
        });
        if (finished) {
          await reader.cancel();
          break;
        }
      }
      reader.releaseLock();
      if (!finished || !accumulated.trim())
        throw new Error(t("ui.responseInterrupted"));
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: t("ui.theRequestFailedTryAgainLater"),
          failed: true,
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
        className={`focus-visible:ring-ring fixed right-6 bottom-6 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 via-indigo-400 to-violet-500 p-0.5 shadow-lg shadow-indigo-500/20 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-indigo-500/30 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transform-none ${
          open ? "pointer-events-none scale-90 opacity-0" : ""
        }`}
        title={t("ui.aiAssistant")}
        aria-label={t("ui.openAiAssistant")}
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
        className={`border-border bg-background fixed right-6 bottom-6 z-50 flex w-96 origin-bottom-right flex-col overflow-hidden rounded-2xl border shadow-2xl transition-all duration-300 ${
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
              {t("ui.faeAiAssistant")}
            </span>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
          </div>
          <button
            type="button"
            title={t("ui.newConversation")}
            aria-label={t("ui.newConversation")}
            disabled={thinking}
            className="mr-3 ml-auto text-white/70 disabled:opacity-40"
            onClick={() => setMessages((prev) => prev.slice(0, 1))}
          >
            <Trash2 size={16} />
          </button>
          <button
            aria-label={t("ui.collapseAiAssistant")}
            onClick={() => setOpen(false)}
            className="text-white/70 transition-colors hover:text-white"
          >
            <ChevronDown size={18} />
          </button>
        </div>

        <p className="border-border text-muted-foreground border-b px-4 py-2 text-xs">
          {pageNames[page]}{" "}
          {t("ui.knowledgeFirstGeneralAnswersWhenNoRelevantSourcesExist")}
        </p>

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
                <div className="bg-primary/10 text-primary mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}

              {/* 气泡 */}
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                }`}
              >
                {msg.loading ? (
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" />
                    {t("ui.thinking")}
                  </span>
                ) : (
                  <MarkdownText
                    content={
                      i === 0
                        ? t("ui.helloIAmYourFaeAiAssistantICanChatSearchThe")
                        : msg.content
                    }
                  />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div className="border-border flex flex-shrink-0 items-center gap-2 border-t px-3 py-3">
          <input
            ref={inputRef}
            maxLength={8000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={t("ui.enterAQuestionEnterToSend")}
            disabled={thinking}
            className="border-border bg-muted/30 focus:ring-primary/30 flex-1 rounded-xl border px-3 py-2 text-sm transition-colors focus:ring-2 focus:outline-none disabled:opacity-50"
          />
          <button
            aria-label={t("ui.sendMessage")}
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
    <div className="space-y-1 break-words whitespace-pre-wrap">
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
