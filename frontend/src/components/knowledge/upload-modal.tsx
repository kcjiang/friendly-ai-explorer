"use client";

import { errorMessage } from "@/lib/errors";

import { useRef, useState } from "react";
import { X, Upload, Loader2, FileText, Image } from "lucide-react";
import apiClient from "@/lib/api";

interface Props {
  onClose:   () => void;
  onSuccess: () => void;
}

export default function UploadModal({ onClose, onSuccess }: Props) {
  const inputRef  = useRef<HTMLInputElement>(null);
  const [file,       setFile]       = useState<File | null>(null);
  const [title,      setTitle]      = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [uploading,  setUploading]  = useState(false);
  const [error,      setError]      = useState("");
  const [dragging,   setDragging]   = useState(false);

  const ALLOWED = [".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".webp"];

  function handleFileSelect(f: File) {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setError(`不支持的格式，仅支持：${ALLOWED.join(", ")}`);
      return;
    }
    setError("");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }

  async function handleUpload() {
    if (!file || !title.trim()) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file",       file);
      fd.append("title",      title.trim());
      fd.append("visibility", visibility);
      await apiClient.post("/api/v1/knowledge/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onSuccess();
    } catch (e: unknown) {
      setError(errorMessage(e, "上传失败，请重试"));
    } finally {
      setUploading(false);
    }
  }

  const FileIcon = file?.name.match(/\.(png|jpg|jpeg|webp)$/i) ? Image : FileText;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-base">上传文件到知识库</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 拖拽区域 */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileIcon size={32} className="text-primary" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <button
                  onClick={e => { e.stopPropagation(); setFile(null); setTitle(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  重新选择
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload size={32} />
                <p className="text-sm">拖拽文件到此处，或点击选择</p>
                <p className="text-xs">支持 PDF、Word、PNG、JPG</p>
              </div>
            )}
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium mb-1.5">文档标题</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="输入文档标题"
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 可见性 */}
          <div>
            <label className="block text-sm font-medium mb-1.5">可见性</label>
            <div className="flex gap-4">
              {(["public", "private"] as const).map(v => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="vis"
                    value={v}
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{v === "public" ? "🌐 公开" : "🔒 私有"}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30
                          border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 border border-border rounded-lg hover:bg-muted/50"
          >
            取消
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file || !title.trim()}
            className="flex items-center gap-1.5 text-sm px-4 py-2 bg-primary
                       text-primary-foreground rounded-lg hover:bg-primary/90
                       disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? "上传中..." : "上传"}
          </button>
        </div>
      </div>
    </div>
  );
}
