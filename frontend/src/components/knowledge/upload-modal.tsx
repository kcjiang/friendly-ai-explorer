"use client";

import { FileText, Image, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function UploadModal({ onClose, onSuccess }: Props) {
  const t = useUiTranslations();

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const ALLOWED = [".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".webp"];

  function handleFileSelect(f: File) {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setError(
        t("dynamic.unsupportedFormatAllowed", { p0: ALLOWED.join(", ") }),
      );
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
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("visibility", visibility);
      await apiClient.post("/api/v1/knowledge/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onSuccess();
    } catch (e: unknown) {
      setError(errorMessage(e, t("ui.uploadFailedTryAgain")));
    } finally {
      setUploading(false);
    }
  }

  const FileIcon = file?.name.match(/\.(png|jpg|jpeg|webp)$/i)
    ? Image
    : FileText;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border-border w-full max-w-md rounded-2xl border shadow-2xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-base font-semibold">
            {t("ui.uploadToKnowledgeBase")}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* 拖拽区域 */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
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
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileIcon size={32} className="text-primary" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground text-xs">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setTitle("");
                  }}
                  className="text-muted-foreground hover:text-foreground text-xs underline"
                >
                  {t("ui.chooseAnotherFile")}
                </button>
              </div>
            ) : (
              <div className="text-muted-foreground flex flex-col items-center gap-2">
                <Upload size={32} />
                <p className="text-sm">
                  {t("ui.dropAFileHereOrClickToSelect")}
                </p>
                <p className="text-xs">{t("ui.supportsPdfWordPngAndJpg")}</p>
              </div>
            )}
          </div>

          {/* 标题 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("ui.documentTitle2")}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("ui.enterADocumentTitle")}
              className="border-border bg-muted/30 focus:ring-primary/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          {/* 可见性 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("ui.visibility")}
            </label>
            <div className="flex gap-4">
              {(["public", "private"] as const).map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <input
                    type="radio"
                    name="vis"
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
          </div>

          {/* 错误提示 */}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-500 dark:border-red-800 dark:bg-red-950/30">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex justify-end gap-3 border-t px-6 py-4">
          <button
            onClick={onClose}
            className="border-border hover:bg-muted/50 rounded-lg border px-4 py-2 text-sm"
          >
            {t("ui.cancel")}
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file || !title.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {uploading ? t("ui.uploading") : t("ui.upload")}
          </button>
        </div>
      </div>
    </div>
  );
}
