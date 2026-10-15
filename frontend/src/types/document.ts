export type DocVisibility = "public" | "private";
export type ContentType   = "markdown" | "pdf" | "docx" | "image";

export interface AuthorBrief {
  id:   string;
  name: string;
}

export interface Document {
  id:                 string;
  title:              string;
  content?:           string;
  content_type:       ContentType;
  file_url?:          string;
  file_original_name?:string;
  visibility:         DocVisibility;
  is_published:       boolean;
  tags?:              string[];
  view_count:         number;
  author:             AuthorBrief;
  created_at:         string;
  updated_at:         string;
  index_status?: "draft" | "empty" | "pending" | "ready" | "text_only";
  indexed_chunks?: number;
  indexed_vectors?: number;
  index_model?: string;
}

export const INDEX_STATUS_LABEL: Record<string, string> = {
  draft: "草稿，未参与 AI 检索", empty: "正文为空", pending: "待重建索引，可检索原文",
  ready: "文本与向量索引就绪", text_only: "文本可检索，向量暂不可用",
};

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  markdown: "📝 Markdown",
  pdf:      "📄 PDF",
  docx:     "📃 Word",
  image:    "🖼️ 图片",
};
