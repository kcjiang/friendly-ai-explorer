"use client";

import { Eye, Lock, Plus, RefreshCw, Search, Upload } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import UploadModal from "@/components/knowledge/upload-modal";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Document } from "@/types/document";
import { CONTENT_TYPE_LABEL, INDEX_STATUS_LABEL } from "@/types/document";

export default function KnowledgePage() {
  const t = useUiTranslations();

  const { data: session } = useSession();
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  async function fetchDocs() {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/v1/knowledge/");
      setDocs(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDocs();
  }, []);

  const filtered = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div>
      {/* 顶部操作栏 */}
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        {/* 搜索框 */}
        <div className="relative">
          <Search
            size={14}
            className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ui.searchTitlesOrTags")}
            className="border-border bg-muted/30 focus:ring-primary/30 w-64 rounded-lg border py-2 pr-4 pl-8 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDocs}
            disabled={loading}
            className="hover:bg-muted/50 text-muted-foreground rounded-lg p-2 transition-colors"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="border-border hover:bg-muted/50 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors"
          >
            <Upload size={14} /> {t("ui.uploadFile")}
          </button>
          <button
            onClick={() => router.push("/knowledge/new")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors"
          >
            <Plus size={14} /> {t("ui.writeDocument")}
          </button>
        </div>
      </div>

      {/* 文档列表 */}
      <div className="p-6">
        <p className="text-muted-foreground mb-4 text-xs">
          {t(
            "ui.aiSearchesOnlyPublishedDocumentsYouCanAccessIfEmbeddingsAreUnavailable",
          )}
        </p>
        {loading ? (
          <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
            {t("ui.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground flex h-64 flex-col items-center justify-center">
            <p className="text-sm">{t("ui.noDocumentsYet")}</p>
            <p className="mt-1 text-xs">
              {t("ui.clickWriteDocumentOrUploadFileToGetStarted")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                currentUserId={session?.user?.id}
                currentUserRole={session?.user?.role}
                onClick={() => router.push(`/knowledge/${doc.id}`)}
                onDeleted={fetchDocs}
              />
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => {
            setShowUpload(false);
            fetchDocs();
          }}
        />
      )}
    </div>
  );
}

// ── Doc Card ──────────────────────────────────────────────────
function DocCard({
  doc,
  currentUserId,
  currentUserRole,
  onClick,
  onDeleted,
}: {
  doc: Document;
  currentUserId?: string;
  currentUserRole?: string;
  onClick: () => void;
  onDeleted: () => void;
}) {
  const t = useUiTranslations();
  const localizedCONTENT_TYPE_LABEL = translateLabels(CONTENT_TYPE_LABEL, t);
  const localizedINDEX_STATUS_LABEL = translateLabels(INDEX_STATUS_LABEL, t);

  const isAuthor = doc.author.id === currentUserId;
  const isDev = currentUserRole === "developer";
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState("");

  async function handleReindex(e: React.MouseEvent) {
    e.stopPropagation();
    setIndexing(true);
    setIndexError("");
    try {
      await apiClient.post(
        `/api/v1/knowledge/${doc.id}/reindex`,
        {},
        { timeout: 60_000 },
      );
      onDeleted();
    } catch (error) {
      setIndexError(errorMessage(error));
    } finally {
      setIndexing(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(t("dynamic.deleteDocument", { p0: doc.title }))) return;
    try {
      await apiClient.delete(`/api/v1/knowledge/${doc.id}`);
      onDeleted();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      onClick={onClick}
      className="bg-background border-border hover:border-primary/40 group cursor-pointer rounded-xl border p-5 transition-all duration-200 hover:shadow-md"
    >
      {/* 顶部：类型 + 可见性 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {localizedCONTENT_TYPE_LABEL[doc.content_type]}
        </span>
        <div className="flex items-center gap-1.5">
          {!doc.is_published && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
              {t("ui.draft")}
            </span>
          )}
          {doc.visibility === "private" ? (
            <Lock size={12} className="text-muted-foreground" />
          ) : (
            <Eye size={12} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {/* 标题 */}
      <h3 className="group-hover:text-primary mb-2 line-clamp-2 text-sm leading-snug font-medium transition-colors">
        {doc.title}
      </h3>
      <p
        className={`mb-2 text-xs ${doc.index_status === "ready" ? "text-green-600" : "text-muted-foreground"}`}
      >
        {localizedINDEX_STATUS_LABEL[doc.index_status ?? "pending"]}
        {doc.indexed_chunks
          ? t("dynamic.vectorChunks", {
              p0: doc.indexed_vectors ?? 0,
              p1: doc.indexed_chunks,
            })
          : ""}
      </p>
      {indexError && (
        <p className="mb-2 text-xs text-red-600" role="alert">
          {indexError}
        </p>
      )}

      {/* 标签 */}
      {doc.tags && doc.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {doc.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 底部：作者 + 操作 */}
      <div className="border-border mt-3 flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-1.5">
          <div className="bg-primary/10 text-primary flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold">
            {doc.author.name[0].toUpperCase()}
          </div>
          <span className="text-muted-foreground text-xs">
            {doc.author.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isAuthor && doc.is_published && doc.index_status !== "empty" && (
            <button
              disabled={indexing}
              onClick={handleReindex}
              className="text-primary text-xs hover:underline disabled:opacity-50"
            >
              {indexing ? t("ui.rebuilding") : t("ui.rebuildIndex")}
            </button>
          )}
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Eye size={11} /> {doc.view_count}
          </span>
          {isDev && (
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 transition-colors hover:text-red-600"
            >
              {t("ui.delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
