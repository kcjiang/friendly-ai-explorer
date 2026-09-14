"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Search, Eye, Lock, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api";
import { Document, CONTENT_TYPE_LABEL } from "@/types/document";
import UploadModal from "@/components/knowledge/upload-modal";

export default function KnowledgePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [docs,    setDocs]    = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
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

  useEffect(() => { fetchDocs(); }, []);

  const filtered = docs.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-wrap gap-3">
        {/* 搜索框 */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索标题或标签..."
            className="pl-8 pr-4 py-2 text-sm rounded-lg border border-border bg-muted/30
                       focus:outline-none focus:ring-2 focus:ring-primary/30 w-64"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDocs}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border
                       rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Upload size={14} /> 上传文件
          </button>
          <button
            onClick={() => router.push("/knowledge/new")}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary
                       text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> 撰写文档
          </button>
        </div>
      </div>

      {/* 文档列表 */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">暂无文档</p>
            <p className="text-xs mt-1">点击右上角&quot;撰写文档&quot;或&quot;上传文件&quot;开始创建</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(doc => (
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
          onSuccess={() => { setShowUpload(false); fetchDocs(); }}
        />
      )}
    </div>
  );
}

// ── Doc Card ──────────────────────────────────────────────────
function DocCard({
  doc, currentUserId, currentUserRole, onClick, onDeleted,
}: {
  doc: Document;
  currentUserId?: string;
  currentUserRole?: string;
  onClick: () => void;
  onDeleted: () => void;
}) {
  const isAuthor = doc.author.id === currentUserId;
  const isDev    = currentUserRole === "developer";

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`确定删除文档「${doc.title}」？`)) return;
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
      className="bg-background border border-border rounded-xl p-5 cursor-pointer
                 hover:shadow-md hover:border-primary/40 transition-all duration-200 group"
    >
      {/* 顶部：类型 + 可见性 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">
          {CONTENT_TYPE_LABEL[doc.content_type]}
        </span>
        <div className="flex items-center gap-1.5">
          {!doc.is_published && (
            <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-950/50
                             dark:text-amber-400 px-1.5 py-0.5 rounded">草稿</span>
          )}
          {doc.visibility === "private" ? (
            <Lock size={12} className="text-muted-foreground" />
          ) : (
            <Eye size={12} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {/* 标题 */}
      <h3 className="font-medium text-sm leading-snug mb-2 line-clamp-2
                     group-hover:text-primary transition-colors">
        {doc.title}
      </h3>

      {/* 标签 */}
      {doc.tags && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {doc.tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 底部：作者 + 操作 */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center
                          text-xs font-semibold text-primary">
            {doc.author.name[0].toUpperCase()}
          </div>
          <span className="text-xs text-muted-foreground">{doc.author.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Eye size={11} /> {doc.view_count}
          </span>
          {isDev && (
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
