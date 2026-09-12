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
}

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  markdown: "📝 Markdown",
  pdf:      "📄 PDF",
  docx:     "📃 Word",
  image:    "🖼️ 图片",
};
