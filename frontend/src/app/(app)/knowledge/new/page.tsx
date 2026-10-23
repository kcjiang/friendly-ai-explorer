"use client";
import { useUiTranslations } from "@/i18n/client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";
import apiClient from "@/lib/api";

export default function NewDocumentPage() {
  const t = useUiTranslations();

  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [isPublished, setIsPublished] = useState(false);
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <button
          onClick={() => router.push("/knowledge")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} /> {t("ui.backToKnowledgeBase")}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPreview((p) => !p)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border
                       rounded-lg hover:bg-muted/50 transition-colors"
          >
            {preview ? <EyeOff size={14} /> : <Eye size={14} />}
            {preview ? t("ui.edit") : t("ui.preview")}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving || !title.trim()}
            className="text-sm px-3 py-1.5 border border-border rounded-lg
                       hover:bg-muted/50 disabled:opacity-50 transition-colors"
          >
            {t("ui.saveDraft")}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !title.trim()}
            className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-primary
                       text-primary-foreground rounded-lg hover:bg-primary/90
                       disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {t("ui.publish")}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：编辑区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 标题 */}
          <div className="px-8 pt-6 pb-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("ui.documentTitle")}
              className="w-full text-2xl font-bold bg-transparent border-none outline-none
                         placeholder:text-muted-foreground/50"
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
                className="w-full h-full min-h-[400px] bg-transparent border-none outline-none
                           text-sm leading-relaxed resize-none font-mono
                           placeholder:text-muted-foreground/40"
              />
            )}
          </div>
        </div>

        {/* 右侧：设置面板 */}
        <div className="w-64 border-l border-border p-5 flex-shrink-0 overflow-y-auto space-y-5">
          <h3 className="text-sm font-semibold">{t("ui.documentSettings")}</h3>

          {/* 可见性 */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              {t("ui.visibility")}
            </label>
            <div className="space-y-1.5">
              {(["public", "private"] as const).map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-2 cursor-pointer"
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
            <p className="text-xs text-muted-foreground mt-2">
              {t("ui.aiCanReadAllPublishedDocumentsRegardlessOfVisibility")}
            </p>
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
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
          <div className="text-xs text-muted-foreground pt-3 border-t border-border space-y-1">
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

  const [ReactMarkdown, setRM] = useState<
    typeof import("react-markdown").default | null
  >(null);
  const [remarkGfm, setGfm] = useState<
    typeof import("remark-gfm").default | null
  >(null);

  useEffect(() => {
    import("react-markdown").then((m) => setRM(() => m.default));
    import("remark-gfm").then((m) => setGfm(() => m.default));
  }, []);

  if (!ReactMarkdown || !remarkGfm) {
    return (
      <div className="text-sm text-muted-foreground">
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
