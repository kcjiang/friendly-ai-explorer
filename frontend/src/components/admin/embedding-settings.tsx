"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface Config {
  protocol: "gemini" | "openai" | "disabled"; base_url: string; model: string;
  use_env_key: boolean; timeout_seconds: number; send_dimensions: boolean;
  query_prefix: string; document_prefix: string; has_api_key: boolean;
  min_similarity: number;
  published_documents: number; indexed_documents: number; reindex_required: boolean;
}
const endpoint = "/api/v1/admin/ai/embedding";
const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const button = "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";

export default function EmbeddingSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { api.get(endpoint).then(r => setConfig(r.data)).catch(e => setError(errorMessage(e))); }, []);
  function change(values: Partial<Config>) { setConfig(c => c ? { ...c, ...values } : c); setDirty(true); setNotice(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!config) return;
    setBusy(true); setError(""); setNotice("");
    const { protocol, base_url, model, use_env_key, timeout_seconds, send_dimensions, query_prefix, document_prefix, min_similarity } = config;
    try {
      const response = await api.put(endpoint, { protocol, base_url, model, use_env_key, timeout_seconds, send_dimensions, query_prefix, document_prefix, min_similarity, api_key: key || null, clear_api_key: clearKey });
      setConfig(response.data); setKey(""); setClearKey(false); setDirty(false);
      setNotice("向量服务已保存。模型、地址或前缀变化后，请在知识库重建原有文档索引。");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { data } = await api.post(`${endpoint}/test`, {}, { timeout: 65_000 });
      const message = `${data.message}（${data.elapsed_ms} ms）`;
      if (data.success) setNotice(message); else setError(message);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border border-border p-5">
    <h2 className="font-semibold">知识库向量服务</h2>
    <p className="text-sm text-muted-foreground">独立于聊天模型。可连接本地 Embedding 模型，也可仅用关键词检索；模型需返回 768 维向量。</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {config && <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">接口类型<select className={input} disabled={busy} value={config.protocol} onChange={e => change({ protocol: e.target.value as Config["protocol"], use_env_key: false })}><option value="openai">OpenAI 兼容 Embeddings（本地 / 网关）</option><option value="gemini">Gemini 原生 Embedding</option><option value="disabled">仅关键词检索</option></select></label>
        <label className="space-y-1 text-sm">模型<input required className={input} maxLength={200} value={config.model} onChange={e => change({ model: e.target.value })} placeholder="BAAI/bge-base-zh-v1.5" /></label>
        <label className="space-y-1 text-sm">API Base URL<input required type="url" className={input} value={config.base_url} onChange={e => change({ base_url: e.target.value })} placeholder="http://你的向量服务器:端口/v1" /></label>
        <label className="space-y-1 text-sm">API Key<input type="password" autoComplete="new-password" className={input} disabled={config.use_env_key} value={key} onChange={e => { setKey(e.target.value); setDirty(true); }} placeholder={config.use_env_key ? "使用环境变量密钥" : config.has_api_key ? "已配置，留空保留（更换地址或协议会清除旧密钥）" : "无认证的本地接口可留空"} /></label>
        <label className="space-y-1 text-sm">超时（秒）<input type="number" required min={5} max={30} className={input} value={config.timeout_seconds} onChange={e => change({ timeout_seconds: Number(e.target.value) })} /></label>
        <label className="space-y-1 text-sm">查询前缀<input className={input} maxLength={300} value={config.query_prefix} onChange={e => change({ query_prefix: e.target.value })} placeholder="按模型文档填写，可留空" /></label>
        <label className="space-y-1 text-sm">文档前缀<input className={input} maxLength={300} value={config.document_prefix} onChange={e => change({ document_prefix: e.target.value })} placeholder="按模型文档填写，可留空" /></label>
        <label className="space-y-1 text-sm">最低向量相似度<input type="number" required min={0} max={1} step={0.01} className={input} value={config.min_similarity} onChange={e => change({ min_similarity: Number(e.target.value) })} /></label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {config.protocol === "gemini" && <label><input type="checkbox" checked={config.use_env_key} onChange={e => { change({ use_env_key: e.target.checked }); setKey(""); }} /> 使用环境变量 GOOGLE_API_KEY</label>}
        {config.protocol === "openai" && <label><input type="checkbox" checked={config.send_dimensions} onChange={e => change({ send_dimensions: e.target.checked })} /> 请求 dimensions=768（接口支持时启用）</label>}
        <label><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setDirty(true); }} /> 清除已保存密钥</label>
      </div>
      <p className="text-xs text-muted-foreground">当前配置下 {config.indexed_documents} / {config.published_documents} 篇已发布文档的向量索引就绪。{config.reindex_required ? "需要重建索引，期间自动使用关键词检索。" : ""}测试使用已保存的配置，不会返回向量或密钥。</p>
      <div className="flex gap-2"><button type="submit" className={button} disabled={busy}>保存向量服务</button><button type="button" className={button} disabled={busy || dirty || config.protocol === "disabled"} onClick={() => void test()}>测试向量服务</button></div>
    </form>}
  </section>;
}
