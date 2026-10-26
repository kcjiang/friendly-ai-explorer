"use client";

import { ArrowLeft, Edit2, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type MarkdownRenderer from "react-markdown";
import type GfmPlugin from "remark-gfm";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Document } from "@/types/document";
import { INDEX_STATUS_LABEL } from "@/types/document";

export default function DocumentDetailPage() {
  const locale = useLocale();

  const t = useUiTranslations();
  const localizedINDEX_STATUS_LABEL = translateLabels(INDEX_STATUS_LABEL, t);

  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();

  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(true);
  const [saving, setSaving] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState("");

  // 编辑表单状态
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [isPublished, setIsPublished] = useState(false);
  const [tags, setTags] = useState("");

  useEffect(() => {
    apiClient
      .get(`/api/v1/knowledge/${id}`)
      .then((res) => {
        const d: Document = res.data;
        setDoc(d);
        setTitle(d.title);
        setContent(d.content ?? "");
        setVisibility(d.visibility);
        setIsPublished(d.is_published);
        setTags(d.tags?.join(", ") ?? "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const isAuthor = doc?.author.id === session?.user?.id;

  async function handleReindex() {
    setIndexing(true);
    setError("");
    try {
      const response = await apiClient.post(
        `/api/v1/knowledge/${id}/reindex`,
        {},
        { timeout: 60_000 },
      );
      setDoc((prev) => (prev ? { ...prev, ...response.data } : prev));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIndexing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await apiClient.patch(`/api/v1/knowledge/${id}`, {
        title: title.trim(),
        content,
        visibility,
        is_published: isPublished,
        tags: tags
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : null,
      });
      setDoc(res.data);
      setEditing(false);
      setPreview(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        {t("ui.loading")}
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="text-muted-foreground flex h-64 flex-col items-center justify-center text-sm">
        <p>{t("ui.documentNotFoundOrAccessDenied")}</p>
        <button
          onClick={() => router.push("/knowledge")}
          className="text-primary mt-2 text-xs"
        >
          {t("ui.backToKnowledgeBase")}
        </button>
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-6 py-3">
        <button
          onClick={() => router.push("/knowledge")}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft size={15} /> {t("ui.backToKnowledgeBase")}
        </button>

        <div className="flex items-center gap-2">
          {isAuthor &&
            !editing &&
            doc.is_published &&
            doc.index_status !== "empty" && (
              <button
                onClick={handleReindex}
                disabled={indexing}
                className="border-border rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {indexing ? t("ui.rebuilding") : t("ui.rebuildIndex")}
              </button>
            )}
          {editing && (
            <button
              onClick={() => setPreview((p) => !p)}
              className="border-border hover:bg-muted/50 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
            >
              {preview ? <EyeOff size={14} /> : <Eye size={14} />}
              {preview ? t("ui.edit") : t("ui.preview")}
            </button>
          )}
          {isAuthor && !editing && (
            <button
              onClick={() => {
                setEditing(true);
                setPreview(false);
              }}
              className="border-border hover:bg-muted/50 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
            >
              <Edit2 size={14} /> {t("ui.edit")}
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => {
                  setEditing(false);
                  setPreview(true);
                }}
                className="border-border hover:bg-muted/50 rounded-lg border px-3 py-1.5 text-sm transition-colors"
              >
                {t("ui.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Save size={13} />
                )}
                {t("ui.save")}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-6 mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {!editing && (
        <p className="text-muted-foreground px-8 py-3 text-xs">
          {localizedINDEX_STATUS_LABEL[doc.index_status ?? "pending"]}{" "}
          {t("ui.currentChunks")}
          {doc.indexed_vectors ?? 0}/{doc.indexed_chunks ?? 0}
          {t("ui.privateDocumentsAreAvailableToTheirAuthorsForAiChatOnly")}
        </p>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 主内容区 */}
        <div className="flex-1 overflow-auto px-8 py-6">
          {editing ? (
            <>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="placeholder:text-muted-foreground/50 mb-4 w-full border-none bg-transparent text-2xl font-bold outline-none"
                placeholder={t("ui.documentTitle2")}
              />
              {preview ? (
                <MarkdownPreview content={content} />
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="placeholder:text-muted-foreground/40 min-h-[500px] w-full resize-none border-none bg-transparent font-mono text-sm leading-relaxed outline-none"
                  placeholder={t("ui.documentContentMarkdownSupported")}
                />
              )}
            </>
          ) : (
            <>
              <h1 className="mb-2 text-2xl font-bold">{doc.title}</h1>
              <p className="text-muted-foreground mb-6 text-xs">
                {doc.author.name} ·{" "}
                {new Date(doc.updated_at).toLocaleString(locale)} · 👁{" "}
                {doc.view_count}
              </p>
              {doc.content ? (
                <MarkdownPreview content={doc.content} />
              ) : doc.file_url ? (
                <div className="border-border text-muted-foreground flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
                  <a
                    href={`${process.env.NEXT_PUBLIC_API_URL}${doc.file_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {doc.file_original_name ?? t("ui.viewFile")}
                  </a>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("ui.noContentYet")}
                </p>
              )}
            </>
          )}
        </div>

        {/* 右侧设置（仅编辑模式） */}
        {editing && (
          <div className="border-border w-64 flex-shrink-0 space-y-5 overflow-y-auto border-l p-5">
            <h3 className="text-sm font-semibold">
              {t("ui.documentSettings")}
            </h3>

            <div>
              <label className="text-muted-foreground mb-2 block text-xs font-medium">
                {t("ui.publicationStatus")}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={(e) => setIsPublished(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-sm">
                  {isPublished ? t("ui.published") : t("ui.draft")}
                </span>
              </label>
            </div>

            <div>
              <label className="text-muted-foreground mb-2 block text-xs font-medium">
                {t("ui.visibility")}
              </label>
              {(["public", "private"] as const).map((v) => (
                <label
                  key={v}
                  className="mb-1.5 flex cursor-pointer items-center gap-2"
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
                    {v === "public" ? t("ui.public") : t("ui.private")}
                  </span>
                </label>
              ))}
            </div>

            <div>
              <label className="text-muted-foreground mb-2 block text-xs font-medium">
                {t("ui.tags")}
              </label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t("ui.commaSeparated")}
                className={inputCls}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Markdown 预览 ─────────────────────────────────────────────
function MarkdownPreview({ content }: { content: string }) {
  const t = useUiTranslations();

  const [ReactMarkdown, setRM] = useState<typeof MarkdownRenderer | null>(null);
  const [remarkGfm, setGfm] = useState<typeof GfmPlugin | null>(null);

  useState(() => {
    import("react-markdown").then((m) => setRM(() => m.default));
    import("remark-gfm").then((m) => setGfm(() => m.default));
  });

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
