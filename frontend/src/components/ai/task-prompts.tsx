"use client";

import { Copy, Loader2, Plus, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

export type TaskPrompt = {
  id: string;
  name: string;
  content: string;
  revision: number;
  owner_name: string;
  can_edit: boolean;
  updated_at: string;
};
export type TaskPreference = { prompt_id: string; language: "zh-CN" | "en" };
const root = "/api/v1/ai-tasks";
const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
const primary = `${button} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;

export function TaskPrompts({
  prompts,
  preferences,
  onRefresh,
}: {
  prompts: TaskPrompt[];
  preferences: TaskPreference;
  onRefresh: () => Promise<unknown>;
}) {
  const [selection, setSelection] = useState(preferences);
  const [editor, setEditor] = useState<{
    id?: string;
    name: string;
    content: string;
    revision?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setSelection({
      prompt_id: preferences.prompt_id,
      language: preferences.language,
    });
  }, [preferences.prompt_id, preferences.language]);

  async function savePreference() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.put(`${root}/preferences`, selection);
      await onRefresh();
      setNotice("已保存我的默认提示词与输出语言，其他用户的设置不受影响。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePrompt(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request({
        method: editor.id ? "PUT" : "POST",
        url: `${root}/prompts${editor.id ? `/${editor.id}` : ""}`,
        data: editor,
      });
      await onRefresh();
      setEditor(null);
      setNotice("提示词已保存，所有用户均可查看和选用。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function openEditor(prompt?: TaskPrompt, copy = false) {
    setError("");
    setNotice("");
    setEditor(
      prompt
        ? {
            id: copy ? undefined : prompt.id,
            revision: copy ? undefined : prompt.revision,
            name: copy ? `${prompt.name}（副本）` : prompt.name,
            content: prompt.content,
          }
        : { name: "", content: "" },
    );
  }
  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="font-medium">我的转换偏好</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            提示词共享，选择和输出语言只对自己生效。导入时可以临时切换。
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <label className="space-y-1 text-sm">
            <span>默认提示词</span>
            <select
              className={input}
              value={selection.prompt_id}
              onChange={(e) =>
                setSelection({ ...selection, prompt_id: e.target.value })
              }
            >
              {prompts.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>输出语言</span>
            <select
              className={input}
              value={selection.language}
              onChange={(e) =>
                setSelection({
                  ...selection,
                  language: e.target.value as TaskPreference["language"],
                })
              }
            >
              <option value="zh-CN">中文 · 简体</option>
              <option value="en">English</option>
            </select>
          </label>
          <button
            disabled={busy || !selection.prompt_id}
            className={primary}
            onClick={savePreference}
          >
            <Save size={15} />
            保存我的偏好
          </button>
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">共享提示词</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            所有人可见；作者可编辑自己的提示词，管理员可维护全部提示词。也可复制后调整。
          </p>
        </div>
        <button className={primary} onClick={() => openEditor()}>
          <Plus size={15} />
          创建提示词
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-600">
          {notice}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {prompts.map((p) => (
          <article
            key={p.id}
            className="space-y-4 rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{p.name}</h3>
              {preferences.prompt_id === p.id && (
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                  我的默认
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {p.owner_name} · 第 {p.revision} 版 ·{" "}
              {new Date(p.updated_at).toLocaleString("zh-CN")}
            </p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm leading-relaxed">
              {p.content}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                onClick={() => {
                  setSelection({ ...selection, prompt_id: p.id });
                  setNotice("已选择，请点击“保存我的偏好”使其生效。");
                }}
              >
                选择此提示词
              </button>
              {p.can_edit && (
                <button className={button} onClick={() => openEditor(p)}>
                  编辑提示词
                </button>
              )}
              <button className={button} onClick={() => openEditor(p, true)}>
                <Copy size={14} />
                复制为新提示词
              </button>
            </div>
          </article>
        ))}
      </div>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy && confirm("关闭提示词编辑？未保存的内容将丢失。"))
            setEditor(null);
        }}
      >
        <DialogContent
          className="z-[80] max-w-3xl overflow-hidden p-6"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogTitle className="pr-8 text-lg font-semibold">
            {editor?.id ? "编辑共享提示词" : "创建共享提示词"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            填写整理问题的业务要求，无需编写 JSON
            格式或占位符。提示词对所有用户可见，请勿填写密码或客户私密资料。
          </DialogDescription>
          {editor && (
            <form
              onSubmit={savePrompt}
              className="mt-4 min-h-0 space-y-4 overflow-auto"
            >
              <label className="block space-y-1 text-sm">
                <span>提示词名称</span>
                <input
                  required
                  maxLength={150}
                  className={input}
                  value={editor.name}
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>提示词内容</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={20000}
                  rows={14}
                  className={`${input} leading-relaxed`}
                  value={editor.content}
                  onChange={(e) =>
                    setEditor({ ...editor, content: e.target.value })
                  }
                  placeholder="例如：请从内部研发视角整理客户反馈，准确表达现象、复现步骤和预期行为。区分确认事实与待确认信息，不推测根因。"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                所选输出语言、模板结构、来源数据和事实约束由系统自动补充。修改共享提示词会影响后续选用它的转换，已有草稿保持原样。
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <button disabled={busy} className={primary}>
                  {busy && <Loader2 size={15} className="animate-spin" />}
                  保存提示词
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
