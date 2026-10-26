"use client";

import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type ReactMarkdownComponent from "react-markdown";
import type remarkGfmPlugin from "remark-gfm";
import { useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";

export default function NewDocumentPage() {
  const t = useUiTranslations();

  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [tags, setTags] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(publish: boolean) {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiClient.post("/api/v1/knowledge/", {
        title: title.trim(),
        content,
        visibility,
        is_published: publish,
        tags: tags
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : null,
      });
      router.push("/knowledge");
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-6 py-3">
        <button
          onClick={() => router.push("/knowledge")}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft size={15} /> {t("ui.backToKnowledgeBase")}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPreview((p) => !p)}
            className="border-border hover:bg-muted/50 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
          >
            {preview ? <EyeOff size={14} /> : <Eye size={14} />}
            {preview ? t("ui.edit") : t("ui.preview")}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving || !title.trim()}
            className="border-border hover:bg-muted/50 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            {t("ui.saveDraft")}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !title.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {t("ui.publish")}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：编辑区 */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 标题 */}
          <div className="px-8 pt-6 pb-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("ui.documentTitle")}
              className="placeholder:text-muted-foreground/50 w-full border-none bg-transparent text-2xl font-bold outline-none"
            />
          </div>

          {/* 编辑器 / 预览 */}
          <div className="flex-1 overflow-auto px-8 pb-6">
            {preview ? (
              <MarkdownPreview content={content} />
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("ui.writeYourDocumentMarkdownSupported")}
                className="placeholder:text-muted-foreground/40 h-full min-h-[400px] w-full resize-none border-none bg-transparent font-mono text-sm leading-relaxed outline-none"
              />
            )}
          </div>
        </div>

        {/* 右侧：设置面板 */}
        <div className="border-border w-64 flex-shrink-0 space-y-5 overflow-y-auto border-l p-5">
          <h3 className="text-sm font-semibold">{t("ui.documentSettings")}</h3>

          {/* 可见性 */}
          <div>
            <label className="text-muted-foreground mb-2 block text-xs font-medium">
              {t("ui.visibility")}
            </label>
            <div className="space-y-1.5">
              {(["public", "private"] as const).map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                    className="accent-primary"
                  />
                  <span className="text-sm">
                    {v === "public" ? t("ui.public") : t("ui.privateOnlyYou")}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              {t("ui.aiCanReadAllPublishedDocumentsRegardlessOfVisibility")}
            </p>
          </div>

          {/* 标签 */}
          <div>
            <label className="text-muted-foreground mb-2 block text-xs font-medium">
              {t("ui.tags")}
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("ui.separateTagsWithCommas")}
              className={inputCls}
            />
          </div>

          {/* 字数统计 */}
          <div className="text-muted-foreground border-border space-y-1 border-t pt-3 text-xs">
            <p>
              {t("ui.characters")}
              {content.length}
            </p>
            <p>
              {t("ui.estimatedChunks")}
              {Math.max(1, Math.ceil(content.length / 800))} {t("ui.chunks")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 简易 Markdown 预览 ────────────────────────────────────────
function MarkdownPreview({ content }: { content: string }) {
  const t = useUiTranslations();

  const [ReactMarkdown, setRM] = useState<typeof ReactMarkdownComponent | null>(
    null,
  );
  const [remarkGfm, setGfm] = useState<typeof remarkGfmPlugin | null>(null);

  useEffect(() => {
    import("react-markdown").then((m) => setRM(() => m.default));
    import("remark-gfm").then((m) => setGfm(() => m.default));
  }, []);

  if (!ReactMarkdown || !remarkGfm) {
    return (
      <div className="text-muted-foreground text-sm">
        {t("ui.loadingPreview")}
      </div>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
