"use client";

import { ArrowLeft, Loader2, Pencil, RefreshCw, Save } from "lucide-react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Document } from "@/types/document";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const d = (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
  const [doc, setDoc] = useState<Document | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api
      .get(`/api/v1/knowledge/${id}`, { signal: controller.signal })
      .then((r) => {
        setDoc(r.data);
        setTitle(r.data.title);
        setContent(r.data.content || "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [id]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api.patch(
        `/api/v1/knowledge/${id}`,
        { title, content },
        { timeout: 60000 },
      );
      setDoc(r.data);
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reindex() {
    setBusy(true);
    setError("");
    try {
      const r = await api.post(
        `/api/v1/knowledge/${id}/reindex`,
        {},
        { timeout: 60000 },
      );
      setDoc((old) => (old ? { ...old, ...r.data } : old));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Link
          href="/knowledge"
          className="mr-auto flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="size-4" />
          {d("Knowledge base", "知识库")}
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !doc}
          onClick={() => void reindex()}
        >
          <RefreshCw />
          {d("Rebuild index", "重建索引")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !doc}
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil />
          {d("Edit", "编辑")}
        </Button>
        {editing && (
          <Button
            size="sm"
            disabled={busy || !title.trim()}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Save />}
            {d("Save", "保存")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {!doc && !error && <Loader2 className="mx-auto animate-spin" />}
      {doc && (
        <>
          {editing ? (
            <>
              <Input
                aria-label={d("Title", "标题")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                aria-label={d("Markdown content", "Markdown 正文")}
                className="h-[65dvh] w-full rounded-lg border bg-transparent p-4 font-mono text-sm"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">{doc.title}</h1>
              <p className="text-muted-foreground text-xs">
                {d("Creator", "创建人")}: {doc.author.name} ·{" "}
                {new Date(doc.updated_at).toLocaleString(locale)} ·{" "}
                {doc.index_status}
              </p>
              <div className="prose dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {doc.content || ""}
                </ReactMarkdown>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
