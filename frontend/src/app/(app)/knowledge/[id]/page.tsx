"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Edit2, Eye, EyeOff, Loader2, Save } from "lucide-react";
import apiClient from "@/lib/api";
import { Document } from "@/types/document";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();

  const [doc,      setDoc]      = useState<Document | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [preview,  setPreview]  = useState(true);
  const [saving,   setSaving]   = useState(false);

  // 编辑表单状态
  const [title,       setTitle]       = useState("");
  const [content,     setContent]     = useState("");
  const [visibility,  setVisibility]  = useState<"public" | "private">("public");
  const [isPublished, setIsPublished] = useState(false);
  const [tags,        setTags]        = useState("");

  useEffect(() => {
    apiClient.get(`/api/v1/knowledge/${id}`)
      .then(res => {
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

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiClient.patch(`/api/v1/knowledge/${id}`, {
        title:        title.trim(),
        content,
        visibility,
        is_published: isPublished,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : null,
      });
      setDoc(res.data);
      setEditing(false);
      setPreview(true);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-sm text-muted-foreground">
        <p>文档不存在或无权访问</p>
        <button onClick={() => router.push("/knowledge")} className="mt-2 text-primary text-xs">
          返回知识库
        </button>
      </div>
    );
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-wrap gap-2">
        <button
          onClick={() => router.push("/knowledge")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} /> 返回知识库
        </button>

        <div className="flex items-center gap-2">
          {editing && (
            <button
              onClick={() => setPreview(p => !p)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border
                         rounded-lg hover:bg-muted/50 transition-colors"
            >
              {preview ? <EyeOff size={14} /> : <Eye size={14} />}
              {preview ? "编辑" : "预览"}
            </button>
          )}
          {isAuthor && !editing && (
            <button
              onClick={() => { setEditing(true); setPreview(false); }}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border
                         rounded-lg hover:bg-muted/50 transition-colors"
            >
              <Edit2 size={14} /> 编辑
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => { setEditing(false); setPreview(true); }}
                className="text-sm px-3 py-1.5 border border-border rounded-lg
                           hover:bg-muted/50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-primary
                           text-primary-foreground rounded-lg hover:bg-primary/90
                           disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                保存
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 主内容区 */}
        <div className="flex-1 overflow-auto px-8 py-6">
          {editing ? (
            <>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full text-2xl font-bold bg-transparent border-none outline-none
                           placeholder:text-muted-foreground/50 mb-4"
                placeholder="文档标题"
              />
              {preview ? (
                <MarkdownPreview content={content} />
              ) : (
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  className="w-full min-h-[500px] bg-transparent border-none outline-none
                             text-sm leading-relaxed resize-none font-mono
                             placeholder:text-muted-foreground/40"
                  placeholder="文档内容（支持 Markdown）..."
                />
              )}
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-2">{doc.title}</h1>
              <p className="text-xs text-muted-foreground mb-6">
                {doc.author.name} · {new Date(doc.updated_at).toLocaleString("zh-CN")} · 👁 {doc.view_count}
              </p>
              {doc.content ? (
                <MarkdownPreview content={doc.content} />
              ) : doc.file_url ? (
                <div className="flex items-center justify-center h-40 border border-dashed
                                border-border rounded-xl text-sm text-muted-foreground">
                  <a
                    href={`${process.env.NEXT_PUBLIC_API_URL}${doc.file_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {doc.file_original_name ?? "查看文件"}
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无内容</p>
              )}
            </>
          )}
        </div>

        {/* 右侧设置（仅编辑模式） */}
        {editing && (
          <div className="w-64 border-l border-border p-5 flex-shrink-0 space-y-5 overflow-y-auto">
            <h3 className="text-sm font-semibold">文档设置</h3>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">发布状态</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={e => setIsPublished(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-sm">{isPublished ? "已发布" : "草稿"}</span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">可见性</label>
              {(["public", "private"] as const).map(v => (
                <label key={v} className="flex items-center gap-2 cursor-pointer mb-1.5">
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{v === "public" ? "🌐 公开" : "🔒 私有"}</span>
                </label>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">标签</label>
              <input
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="逗号分隔"
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
  const [ReactMarkdown, setRM]  = useState<any>(null);
  const [remarkGfm,     setGfm] = useState<any>(null);

  useState(() => {
    import("react-markdown").then(m => setRM(() => m.default));
    import("remark-gfm").then(m => setGfm(() => m.default));
  });

  if (!ReactMarkdown || !remarkGfm) {
    return <div className="text-sm text-muted-foreground">加载预览中...</div>;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
