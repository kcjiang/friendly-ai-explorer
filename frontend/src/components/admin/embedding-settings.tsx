"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base/alert-dialog";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { NativeSelect } from "@/components/ui/base/native-select";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface Config {
  id?: string;
  name: string;
  active_profile_id?: string | null;
  vendor: "openai" | "gemini" | "deepseek" | "qwen" | "other";
  protocol: "gemini" | "openai" | "disabled";
  base_url: string;
  model: string;
  timeout_seconds: number;
  send_dimensions: boolean;
  query_prefix: string;
  document_prefix: string;
  has_api_key: boolean;
  min_similarity: number;
  published_documents: number;
  indexed_documents: number;
  reindex_required: boolean;
}
type Profile = Omit<
  Config,
  "published_documents" | "indexed_documents" | "reindex_required"
> & { id: string };
const blank: Config = {
  name: "",
  vendor: "other",
  protocol: "openai",
  base_url: "",
  model: "",
  timeout_seconds: 16,
  send_dimensions: false,
  query_prefix: "",
  document_prefix: "",
  has_api_key: false,
  min_similarity: 0.65,
  published_documents: 0,
  indexed_documents: 0,
  reindex_required: false,
};
const endpoint = "/api/v1/admin/ai/embedding";
const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const button =
  "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";

export default function EmbeddingSettings() {
  const [active, setActive] = useState<Config | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const [current, saved] = await Promise.all([
      api.get(endpoint),
      api.get(`${endpoint}/profiles`),
    ]);
    setActive(current.data);
    setProfiles(saved.data);
  }
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, []);
  function edit(profile?: Profile) {
    setConfig({ ...blank, ...profile });
    setKey("");
    setClearKey(false);
    setDirty(false);
    setError("");
    setNotice("");
  }
  async function activate(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.put(`${endpoint}/active`, {
        profile_id: id || null,
      });
      setActive(data);
      setNotice(
        data.reindex_required
          ? "已切换服务。需要在知识库重建文档索引，期间使用关键词检索。"
          : "已切换当前检索服务。",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(profile: Profile) {
    setBusy(true);
    setError("");
    try {
      await api.delete(`${endpoint}/profiles/${profile.id}`);
      await load();
      setNotice("向量服务已删除。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }
  function change(values: Partial<Config>) {
    setConfig((c) => (c ? { ...c, ...values } : c));
    setDirty(true);
    setNotice("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setBusy(true);
    setError("");
    setNotice("");
    const {
      name,
      vendor,
      protocol,
      base_url,
      model,
      timeout_seconds,
      send_dimensions,
      query_prefix,
      document_prefix,
      min_similarity,
    } = config;
    try {
      const payload = {
        name,
        vendor,
        protocol,
        base_url,
        model,
        timeout_seconds,
        send_dimensions,
        query_prefix,
        document_prefix,
        min_similarity,
        api_key: key || null,
        clear_api_key: clearKey,
      };
      if (config.id)
        await api.put(`${endpoint}/profiles/${config.id}`, payload);
      else await api.post(`${endpoint}/profiles`, payload);
      await load();
      setConfig(null);
      setKey("");
      setClearKey(false);
      setDirty(false);
      setNotice(
        "配置已保存；新服务不会自动启用。更改当前服务的模型、地址或前缀后，请在知识库重建索引。",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function test(profileId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.post(
        `${endpoint}/profiles/${profileId}/test`,
        {},
        { timeout: 65_000 },
      );
      const message = `${data.message}（${data.elapsed_ms} ms）`;
      if (data.success) setNotice(message);
      else setError(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border-border space-y-4 rounded-xl border p-5">
      <h2 className="font-semibold">知识库向量服务</h2>
      <p className="text-muted-foreground text-sm">
        独立于聊天模型，可保存多个服务并选择当前使用的服务；模型需返回 768
        维向量。
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        “其他提供商（兼容接口）”用于未列出的品牌或统一 API
        网关，例如通过兼容接口提供 BGE、E5
        的服务。请按实际接口选择协议；品牌名称不代表一定提供向量模型。
      </p>
      {active && (
        <div className="space-y-2">
          <label className="block space-y-1 text-sm">
            当前使用的向量服务
            <NativeSelect
              className="w-full"
              value={active.active_profile_id ?? ""}
              disabled={busy || !!config}
              onChange={(e) => void activate(e.target.value)}
            >
              <option value="">仅关键词检索</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </NativeSelect>
          </label>
          {active.protocol !== "disabled" && (
            <p className="text-muted-foreground text-xs">
              当前索引就绪：{active.indexed_documents} /{" "}
              {active.published_documents} 篇。
              {active.reindex_required
                ? "需要重建索引，未就绪的内容使用关键词检索。"
                : ""}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">已保存的向量服务</h3>
        <Button
          variant="outline"
          disabled={busy || !!config}
          onClick={() => edit()}
        >
          添加向量服务
        </Button>
      </div>
      {!profiles.length && (
        <p className="text-muted-foreground text-sm">
          尚未添加向量服务；当前使用关键词检索。
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((p) => (
          <div key={p.id} className="min-w-0 space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium break-all">{p.name}</h4>
              {p.id === active?.active_profile_id && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  当前使用
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs break-all">
              {p.model} ·{" "}
              {p.protocol === "gemini"
                ? "Google Gemini Embedding API"
                : "OpenAI 兼容 Embeddings"}
              <br />
              {p.base_url}
            </p>
            <p className="text-muted-foreground text-xs">
              密钥：{p.has_api_key ? "已加密保存" : "未配置"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!config}
                onClick={() => edit(p)}
              >
                编辑
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!config}
                onClick={() => void test(p.id)}
              >
                测试
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy || !!config || p.id === active?.active_profile_id
                }
                onClick={() => void activate(p.id)}
              >
                使用此服务
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy || !!config || p.id === active?.active_profile_id
                }
                onClick={() => setDeleting(p)}
              >
                删除
              </Button>
            </div>
          </div>
        ))}
      </div>
      {config && (
        <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
          <fieldset disabled={busy} className="space-y-4">
            <h3 className="text-sm font-medium">
              {config.id ? "编辑向量服务" : "添加向量服务"}
            </h3>
            <label className="block space-y-1 text-sm">
              向量服务名称
              <Input
                required
                maxLength={100}
                value={config.name}
                onChange={(e) => change({ name: e.target.value })}
                placeholder="例如 Qwen 向量服务"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1 text-sm">
                提供商
                <NativeSelect
                  className="w-full"
                  value={config.vendor}
                  onChange={(e) =>
                    change({ vendor: e.target.value as Config["vendor"] })
                  }
                >
                  <option value="other">其他提供商（兼容接口）</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="qwen">Qwen</option>
                </NativeSelect>
              </label>
              <label className="space-y-1 text-sm">
                接口类型
                <NativeSelect
                  className="w-full"
                  disabled={busy}
                  value={config.protocol}
                  onChange={(e) =>
                    change({ protocol: e.target.value as Config["protocol"] })
                  }
                >
                  <option value="openai">OpenAI 兼容 Embeddings</option>
                  <option value="gemini">Google Gemini Embedding API</option>
                </NativeSelect>
              </label>
              <label className="space-y-1 text-sm">
                模型
                <Input
                  required={config.protocol !== "disabled"}
                  disabled={config.protocol === "disabled"}
                  className={input}
                  maxLength={200}
                  value={config.model}
                  onChange={(e) => change({ model: e.target.value })}
                  placeholder="BAAI/bge-base-zh-v1.5"
                />
              </label>
              <label className="space-y-1 text-sm">
                API Base URL
                <Input
                  required={config.protocol !== "disabled"}
                  disabled={config.protocol === "disabled"}
                  type="url"
                  className={input}
                  value={config.base_url}
                  onChange={(e) => change({ base_url: e.target.value })}
                  placeholder="http://你的向量服务器:端口/v1"
                />
              </label>
              <label className="space-y-1 text-sm">
                API Key
                <Input
                  type="password"
                  autoComplete="new-password"
                  className={input}
                  disabled={busy || config.protocol === "disabled"}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setDirty(true);
                  }}
                  placeholder={
                    config.has_api_key
                      ? "已配置，留空保留（更换地址或协议会清除旧密钥）"
                      : "无认证的本地接口可留空"
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                超时（秒）
                <Input
                  type="number"
                  required
                  min={5}
                  max={30}
                  className={input}
                  value={config.timeout_seconds}
                  onChange={(e) =>
                    change({ timeout_seconds: Number(e.target.value) })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                查询前缀
                <Input
                  className={input}
                  maxLength={300}
                  value={config.query_prefix}
                  onChange={(e) => change({ query_prefix: e.target.value })}
                  placeholder="按模型文档填写，可留空"
                />
              </label>
              <label className="space-y-1 text-sm">
                文档前缀
                <Input
                  className={input}
                  maxLength={300}
                  value={config.document_prefix}
                  onChange={(e) => change({ document_prefix: e.target.value })}
                  placeholder="按模型文档填写，可留空"
                />
              </label>
              <label className="space-y-1 text-sm">
                最低向量相似度
                <Input
                  type="number"
                  required
                  min={0}
                  max={1}
                  step={0.01}
                  className={input}
                  value={config.min_similarity}
                  onChange={(e) =>
                    change({ min_similarity: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {config.protocol === "openai" && (
                <label>
                  <input
                    type="checkbox"
                    checked={config.send_dimensions}
                    onChange={(e) =>
                      change({ send_dimensions: e.target.checked })
                    }
                  />{" "}
                  请求 dimensions=768（接口支持时启用）
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(e) => {
                    setClearKey(e.target.checked);
                    setDirty(true);
                  }}
                />{" "}
                清除已保存密钥
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              测试使用已保存的配置，不会返回向量或密钥。
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="outline"
                className={button}
                disabled={busy}
              >
                保存向量服务
              </Button>
              <Button
                type="button"
                variant="outline"
                className={button}
                disabled={busy || dirty || !config.id}
                onClick={() => config.id && void test(config.id)}
              >
                测试向量服务
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfig(null);
                  setKey("");
                  setClearKey(false);
                  setDirty(false);
                }}
              >
                取消
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除向量服务</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除“{deleting?.name}”及其已保存的连接密钥？知识库文档将保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => deleting && void remove(deleting)}
            >
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
