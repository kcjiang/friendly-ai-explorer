"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { NativeSelect } from "@/components/ui/base/native-select";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import EmbeddingSettings from "./embedding-settings";

interface Provider {
  id: string;
  name: string;
  vendor: "openai" | "gemini" | "deepseek" | "qwen" | "other";
  auth_required: boolean;
  token_parameter: "max_tokens" | "max_completion_tokens";
  capability_checks: Record<string, { status: string; tested_at: string }>;
  protocol: "openai" | "gemini" | "responses";
  base_url: string;
  model: string;
  enabled: boolean;
  timeout_seconds: number;
  max_output_tokens: number;
  max_concurrency: number;
  has_api_key: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  thinking_mode: "auto" | "off" | "on";
  structured_output: "auto" | "schema" | "object" | "off";
  temperature: number | null;
  retry_count: number;
}
interface Route {
  task: string;
  label: string;
  requirements: { id: string; label: string }[];
  provider_id: string | null;
  fallback_provider_id: string | null;
  timeout_seconds: number | null;
  max_output_tokens: number | null;
}
interface CallLog {
  id: string;
  task: string;
  provider_name: string;
  model: string;
  success: boolean;
  fallback: boolean;
  elapsed_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  created_at: string;
  request_id: string | null;
  diagnostics: Record<string, unknown>;
}
interface TestResult {
  ok: boolean;
  message: string;
  reply: string;
  elapsed_ms: number;
  model: string;
  tested_at: string;
  mode: string;
  configuration_current: boolean;
  capability_checks: Provider["capability_checks"];
  diagnostics: Record<string, unknown>;
}
type Draft = Pick<
  Provider,
  | "name"
  | "protocol"
  | "vendor"
  | "auth_required"
  | "token_parameter"
  | "base_url"
  | "model"
  | "enabled"
  | "timeout_seconds"
  | "max_output_tokens"
  | "max_concurrency"
  | "thinking_mode"
  | "structured_output"
  | "temperature"
  | "retry_count"
> & { api_key: string };
const fresh: Draft = {
  name: "",
  vendor: "other",
  auth_required: true,
  token_parameter: "max_tokens",
  protocol: "openai",
  base_url: "",
  model: "",
  api_key: "",
  enabled: true,
  timeout_seconds: 90,
  max_output_tokens: 2048,
  max_concurrency: 1,
  thinking_mode: "auto",
  structured_output: "auto",
  temperature: null,
  retry_count: 1,
};
const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const button =
  "rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/50 disabled:opacity-50";
const primary =
  "rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50";
const vendors = {
  openai: "OpenAI",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  other: "其他提供商（兼容接口）",
};
const protocols = {
  openai: "OpenAI Chat Completions",
  responses: "OpenAI Responses",
  gemini: "Google Gemini API",
};
const capabilityLabels: Record<string, string> = {
  text: "文本生成",
  conversation: "多轮对话",
  json: "结构化 JSON",
  stream: "流式输出",
};
const statusLabels: Record<string, string> = {
  verified: "已验证",
  unsupported: "不支持",
  unknown: "未验证",
};
const endpoint = "/api/v1/admin/ai";
const date = (value: string) => new Date(value).toLocaleString("zh-CN");

export default function AISettings({
  onInspectRequest,
}: {
  onInspectRequest?: (id: string) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null | undefined>();
  const [draft, setDraft] = useState<Draft>(fresh);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [testModes, setTestModes] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [dirty, setDirty] = useState(false);
  const [selectedLog, setSelectedLog] = useState<CallLog | null>(null);

  async function load(initial = false) {
    if (initial) setLoading(true);
    setError("");
    try {
      const [p, r, l] = await Promise.all([
        api.get(`${endpoint}/providers`),
        api.get(`${endpoint}/routes`),
        api.get(`${endpoint}/logs`),
      ]);
      setProviders(p.data);
      setRoutes(r.data);
      setLogs(l.data);
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (initial) setLoading(false);
    }
  }
  useEffect(() => {
    void load(true);
  }, []);

  function edit(provider?: Provider) {
    setEditing(provider?.id ?? null);
    setError("");
    setNotice("");
    setDraft(
      provider
        ? {
            name: provider.name,
            vendor: provider.vendor,
            auth_required: provider.auth_required,
            token_parameter: provider.token_parameter,
            protocol: provider.protocol,
            base_url: provider.base_url,
            model: provider.model,
            enabled: provider.enabled,
            timeout_seconds: provider.timeout_seconds,
            max_output_tokens: provider.max_output_tokens,
            max_concurrency: provider.max_concurrency,
            api_key: "",
            thinking_mode: provider.thinking_mode,
            structured_output: provider.structured_output,
            temperature: provider.temperature,
            retry_count: provider.retry_count,
          }
        : { ...fresh },
    );
  }
  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = { ...draft, api_key: draft.api_key.trim() || null };
      const response = editing
        ? await api.put(`${endpoint}/providers/${editing}`, payload)
        : await api.post(`${endpoint}/providers`, payload);
      setProviders((prev) => [
        ...prev.filter((p) => p.id !== response.data.id),
        response.data,
      ]);
      setResults((prev) => {
        const next = { ...prev };
        delete next[response.data.id];
        return next;
      });
      setEditing(undefined);
      setDraft({ ...fresh });
      setNotice("服务已保存；请验证任务所需能力，再分配给任务。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  async function remove(provider: Provider) {
    if (!confirm(`删除 AI 服务“${provider.name}”？`)) return;
    setBusy(provider.id);
    setError("");
    setNotice("");
    try {
      await api.delete(`${endpoint}/providers/${provider.id}`);
      setProviders((prev) => prev.filter((p) => p.id !== provider.id));
      setNotice("服务已删除。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function test(provider: Provider) {
    setBusy(provider.id);
    setError("");
    setNotice("");
    try {
      const response = await api.post(
        `${endpoint}/providers/${provider.id}/test`,
        { mode: testModes[provider.id] ?? "chat" },
        { timeout: 310_000 },
      );
      const result: TestResult = response.data;
      setResults((prev) => ({ ...prev, [provider.id]: result }));
      if (result.configuration_current) {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === provider.id
              ? {
                  ...p,
                  capability_checks: result.capability_checks,
                  last_test_ok: result.ok,
                  last_test_at: result.tested_at,
                  last_test_message: result.message,
                }
              : p,
          ),
        );
      } else {
        setNotice(
          "测试期间服务配置已更改，此结果仅适用于测试开始时的配置，请刷新后重新测试。",
        );
      }
      const l = await api.get(`${endpoint}/logs`);
      setLogs(l.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  function changeRoute(task: string, patch: Partial<Route>) {
    setRoutes((prev) =>
      prev.map((r) => (r.task === task ? { ...r, ...patch } : r)),
    );
    setDirty(true);
    setNotice("");
  }
  async function saveRoutes() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api.put(`${endpoint}/routes`, {
        routes: routes.map(
          ({
            task,
            provider_id,
            fallback_provider_id,
            timeout_seconds,
            max_output_tokens,
          }) => ({
            task,
            provider_id,
            fallback_provider_id,
            timeout_seconds,
            max_output_tokens,
          }),
        ),
      });
      setRoutes(response.data);
      setDirty(false);
      setNotice("任务分配已保存，新请求立即生效。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  const enabled = providers.filter((p) => p.enabled);
  const defaultRoute = routes.find((r) => r.task === "default");
  const providerName = (id: string | null | undefined) =>
    providers.find((p) => p.id === id)?.name ?? "未配置";
  if (loading)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );

  return (
    <div className="space-y-8">
      <EmbeddingSettings />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          管理服务、测试模型，并为每项任务选择 AI。配置保存后对新请求生效。
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className={button}
            disabled={saving || !!busy}
            onClick={() => {
              if (!dirty || confirm("刷新会丢弃未保存的任务分配，继续？"))
                void load();
            }}
          >
            <RefreshCw size={14} className="mr-1 inline" />
            刷新
          </Button>
          <Button
            className={primary}
            disabled={saving || !!busy}
            onClick={() => edit()}
          >
            <Plus size={14} className="mr-1 inline" />
            添加服务
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm"
        >
          {notice}
        </div>
      )}

      {editing !== undefined && (
        <form
          onSubmit={saveProvider}
          className="border-border space-y-4 rounded-xl border p-5"
        >
          <h2 className="font-semibold">
            {editing ? "编辑 AI 服务" : "添加 AI 服务"}
          </h2>
          <Button
            type="button"
            variant="outline"
            className={button}
            onClick={() =>
              setDraft({
                ...draft,
                timeout_seconds: 180,
                max_output_tokens: 1024,
                max_concurrency: 1,
                thinking_mode: "off",
                structured_output: "auto",
                temperature: 0.7,
                retry_count: 1,
              })
            }
          >
            应用低延迟参数
          </Button>
          <p className="text-muted-foreground text-xs">
            “其他提供商（兼容接口）”用于未列出的品牌或统一 API
            网关；选择服务实际支持的接口类型即可，不代表任意模型都能直接接入。OpenAI、Gemini、DeepSeek、Qwen
            仍选择对应品牌。
          </p>
          <p className="text-muted-foreground text-xs">
            任务由管理员手动分配。自动模式会对经典 Qwen3 关闭思考，对 TODO /
            邮件优先请求结构化
            JSON。其他模型保持原有思考行为；可根据实际接口手动调整。
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1 text-sm">
              提供商
              <NativeSelect
                className="w-full"
                value={draft.vendor}
                onChange={(e) => {
                  const vendor = e.target.value as Draft["vendor"];
                  const presets = {
                    openai: {
                      protocol: "openai" as const,
                      base_url: "https://api.openai.com/v1",
                      token_parameter: "max_completion_tokens" as const,
                    },
                    gemini: {
                      protocol: "gemini" as const,
                      base_url:
                        "https://generativelanguage.googleapis.com/v1beta",
                      token_parameter: "max_tokens" as const,
                    },
                    deepseek: {
                      protocol: "openai" as const,
                      base_url: "https://api.deepseek.com/v1",
                      token_parameter: "max_tokens" as const,
                    },
                    qwen: {
                      protocol: "openai" as const,
                      base_url: "",
                      token_parameter: "max_tokens" as const,
                    },
                    other: {
                      protocol: "openai" as const,
                      base_url: "",
                      token_parameter: "max_tokens" as const,
                    },
                  };
                  setDraft({
                    ...draft,
                    vendor,
                    ...presets[vendor],
                    api_key: "",
                  });
                }}
              >
                {Object.entries(vendors).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="block space-y-1 text-sm">
              服务名称
              <Input
                required
                maxLength={100}
                className={input}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如 Qwen 服务"
              />
            </label>
            <label className="block space-y-1 text-sm">
              接口类型
              <NativeSelect
                className="w-full"
                value={draft.protocol}
                onChange={(e) => {
                  const protocol = e.target.value as Draft["protocol"];
                  setDraft({
                    ...draft,
                    protocol,
                    base_url:
                      protocol === "gemini"
                        ? "https://generativelanguage.googleapis.com/v1beta"
                        : "",
                    api_key: "",
                  });
                }}
              >
                <option value="openai">OpenAI Chat Completions</option>
                <option value="responses">OpenAI Responses</option>
                <option value="gemini">Google Gemini API</option>
              </NativeSelect>
            </label>
            <label className="block space-y-1 text-sm">
              认证方式
              <NativeSelect
                className="w-full"
                value={draft.auth_required ? "key" : "none"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    auth_required: e.target.value === "key",
                    api_key: "",
                  })
                }
              >
                <option value="key">API Key</option>
                <option value="none">无需认证</option>
              </NativeSelect>
            </label>
            {draft.protocol === "openai" && (
              <label className="block space-y-1 text-sm">
                输出长度参数
                <NativeSelect
                  className={input}
                  value={draft.token_parameter}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      token_parameter: e.target
                        .value as Draft["token_parameter"],
                    })
                  }
                >
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">
                    max_completion_tokens
                  </option>
                </NativeSelect>
              </label>
            )}
            <label className="block space-y-1 text-sm">
              API Base URL
              <Input
                type="url"
                required
                maxLength={1000}
                className={input}
                value={draft.base_url}
                onChange={(e) =>
                  setDraft({ ...draft, base_url: e.target.value })
                }
                placeholder="https://服务地址/v1"
              />
            </label>
            <label className="block space-y-1 text-sm">
              模型名称
              <Input
                required
                maxLength={200}
                className={input}
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="填写服务实际提供的模型 ID"
              />
            </label>
            <label className="block space-y-1 text-sm md:col-span-2">
              API Key
              <Input
                type="password"
                required={!editing && draft.auth_required}
                disabled={!draft.auth_required}
                autoComplete="new-password"
                className={input}
                value={draft.api_key}
                onChange={(e) =>
                  setDraft({ ...draft, api_key: e.target.value })
                }
                placeholder={
                  editing
                    ? "留空保留原密钥；更改接口类型需重新填写"
                    : "输入 API Key，仅由后端加密保存"
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              超时（秒）
              <Input
                type="number"
                required
                min={5}
                max={300}
                className={input}
                value={draft.timeout_seconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    timeout_seconds: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              最大输出 Token
              <Input
                type="number"
                required
                min={16}
                max={65536}
                className={input}
                value={draft.max_output_tokens}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_output_tokens: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              最大并发（每后端进程）
              <Input
                type="number"
                required
                min={1}
                max={32}
                className={input}
                value={draft.max_concurrency}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_concurrency: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              思考模式
              <NativeSelect
                className="w-full"
                value={draft.thinking_mode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    thinking_mode: e.target.value as Draft["thinking_mode"],
                  })
                }
              >
                <option value="auto">自动兼容</option>
                <option value="off">关闭思考（接口需支持）</option>
                <option value="on">开启思考（接口需支持）</option>
              </NativeSelect>
            </label>
            <label className="block space-y-1 text-sm">
              结构化输出
              <NativeSelect
                className="w-full"
                value={draft.structured_output}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    structured_output: e.target
                      .value as Draft["structured_output"],
                  })
                }
              >
                <option value="auto">自动：Schema → JSON → 提示词</option>
                <option value="schema">强制 JSON Schema</option>
                <option value="object">JSON 对象模式</option>
                <option value="off">仅提示词约束</option>
              </NativeSelect>
            </label>
            <label className="block space-y-1 text-sm">
              采样温度（留空使用模型默认）
              <Input
                type="number"
                step="0.1"
                min={0}
                max={2}
                className={input}
                value={draft.temperature ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    temperature: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              临时故障重试次数
              <Input
                type="number"
                required
                min={0}
                max={2}
                className={input}
                value={draft.retry_count}
                onChange={(e) =>
                  setDraft({ ...draft, retry_count: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              启用服务
            </label>
          </div>
          {draft.base_url.startsWith("http://") && (
            <p className="text-xs text-amber-600">
              当前使用 HTTP，密钥与请求内容将明文传输；公网使用建议配置 HTTPS。
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving} className={primary}>
              {saving ? "保存中…" : "保存服务"}
            </Button>
            <Button
              type="button"
              disabled={saving}
              variant="outline"
              className={button}
              onClick={() => {
                setEditing(undefined);
                setDraft({ ...fresh });
              }}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">AI 服务</h2>
        <p className="text-muted-foreground text-xs">
          各项测试分别验证能力，会实际调用模型，产生少量推理开销；最近测试结果不代表实时在线状态。禁用或删除前，请先解除任务引用。
        </p>
        {!providers.length && (
          <p className="text-muted-foreground text-sm">
            尚未配置 AI 服务。请添加服务，填写 API Key
            并测试连接，再完成任务分配。
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className="border-border min-w-0 space-y-3 rounded-xl border p-4"
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-medium break-all">{p.name}</h3>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {p.enabled ? "已启用" : "已禁用"}
                </span>
              </div>
              <p className="text-muted-foreground text-xs break-all">
                {vendors[p.vendor]} · {protocols[p.protocol]} · {p.model}
                <br />
                {p.base_url}
              </p>
              <p className="text-muted-foreground text-xs">
                密钥：{p.has_api_key ? "已加密保存" : "未配置"} · 超时{" "}
                {p.timeout_seconds}s · 输出 {p.max_output_tokens} Token · 并发{" "}
                {p.max_concurrency}
              </p>
              <p
                className={`text-xs ${p.last_test_ok === false ? "text-red-600" : "text-muted-foreground"}`}
              >
                {p.last_test_at
                  ? `${date(p.last_test_at)} 最近测试${p.last_test_ok ? "成功" : "失败"}：${p.last_test_message}`
                  : "尚未测试此配置"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className={button}
                  disabled={saving || !!busy}
                  onClick={() => edit(p)}
                >
                  编辑
                </Button>
                <Button
                  variant="outline"
                  className={button}
                  disabled={saving || !!busy}
                  onClick={() => void remove(p)}
                >
                  删除
                </Button>
                <NativeSelect
                  aria-label={`${p.name} 测试类型`}
                  className="w-full sm:w-auto"
                  value={testModes[p.id] ?? "chat"}
                  disabled={!!busy}
                  onChange={(e) =>
                    setTestModes((prev) => ({
                      ...prev,
                      [p.id]: e.target.value,
                    }))
                  }
                >
                  <option value="chat">普通回答</option>
                  <option value="json">JSON 输出</option>
                  <option value="stream">流式输出</option>
                  <option value="conversation">多轮对话</option>
                </NativeSelect>
                <Button
                  variant="outline"
                  className={button}
                  disabled={saving || !!busy}
                  onClick={() => void test(p)}
                >
                  {busy === p.id ? (
                    <>
                      <Loader2 size={12} className="mr-1 inline animate-spin" />
                      处理中…
                    </>
                  ) : (
                    "测试连接"
                  )}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(capabilityLabels).map(([id, label]) => {
                  const check = p.capability_checks?.[id];
                  return (
                    <span
                      key={id}
                      className="rounded border px-2 py-1"
                      title={
                        check?.tested_at
                          ? date(check.tested_at)
                          : "请运行对应能力测试"
                      }
                    >
                      {label}：{statusLabels[check?.status ?? "unknown"]}
                    </span>
                  );
                })}
              </div>
              {results[p.id] && (
                <div
                  className="bg-muted/40 space-y-2 rounded-lg p-3 text-xs"
                  role="status"
                >
                  <p>
                    {results[p.id].message} · {results[p.id].elapsed_ms} ms ·{" "}
                    {results[p.id].model}
                  </p>
                  {results[p.id].reply && (
                    <pre className="break-all whitespace-pre-wrap">
                      {results[p.id].reply}
                    </pre>
                  )}
                  <details>
                    <summary className="cursor-pointer">测试诊断</summary>
                    <pre className="mt-2 break-all whitespace-pre-wrap">
                      {JSON.stringify(results[p.id].diagnostics, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">
          任务分配{" "}
          {dirty && <span className="text-xs text-amber-600">未保存</span>}
        </h2>
        <p className="text-muted-foreground text-xs">
          选择“跟随默认”的任务同时继承默认备用服务；指定主服务的任务可单独关闭备用。超时与输出限制留空时继承默认设置，再使用实际服务的设置。
        </p>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                {["任务", "主服务", "备用服务", "超时（秒）", "输出 Token"].map(
                  (t) => (
                    <th key={t} className="p-3 text-left font-medium">
                      {t}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.task} className="border-border border-t">
                  <td className="p-3">
                    <p className="font-medium">{r.label}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      必需：{r.requirements.map((c) => c.label).join("、")}
                    </p>
                    {[
                      r.provider_id || defaultRoute?.provider_id,
                      r.fallback_provider_id ||
                        (!r.provider_id
                          ? defaultRoute?.fallback_provider_id
                          : null),
                    ]
                      .filter(Boolean)
                      .map((id) => {
                        const p = providers.find((p) => p.id === id);
                        const missing = r.requirements.filter(
                          (c) =>
                            p?.capability_checks?.[c.id]?.status !== "verified",
                        );
                        return (
                          <p
                            key={id}
                            className={
                              missing.length
                                ? "mt-1 text-xs text-amber-600"
                                : "text-muted-foreground mt-1 text-xs"
                            }
                          >
                            {p?.name}：
                            {missing.length
                              ? "需要验证 " +
                                missing.map((c) => c.label).join("、")
                              : "满足要求"}
                          </p>
                        );
                      })}
                    {r.task !== "default" && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        实际：
                        {providerName(
                          r.provider_id || defaultRoute?.provider_id,
                        )}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <NativeSelect
                      aria-label={`${r.label}主服务`}
                      className={input}
                      value={r.provider_id ?? ""}
                      onChange={(e) =>
                        changeRoute(r.task, {
                          provider_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">
                        {r.task === "default" ? "未配置" : "跟随默认"}
                      </option>
                      {enabled.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="p-3">
                    <NativeSelect
                      aria-label={`${r.label}备用服务`}
                      className={input}
                      value={r.fallback_provider_id ?? ""}
                      onChange={(e) =>
                        changeRoute(r.task, {
                          fallback_provider_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">
                        {r.task !== "default" && !r.provider_id
                          ? "跟随默认备用"
                          : "不使用备用"}
                      </option>
                      {enabled.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="p-3">
                    <Input
                      aria-label={`${r.label}超时`}
                      type="number"
                      min={5}
                      max={300}
                      placeholder="继承"
                      className={input}
                      value={r.timeout_seconds ?? ""}
                      onChange={(e) =>
                        changeRoute(r.task, {
                          timeout_seconds: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      aria-label={`${r.label}输出限制`}
                      type="number"
                      min={16}
                      max={65536}
                      placeholder="继承"
                      className={input}
                      value={r.max_output_tokens ?? ""}
                      onChange={(e) =>
                        changeRoute(r.task, {
                          max_output_tokens: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          className={primary}
          disabled={saving || !!busy || !dirty}
          onClick={() => void saveRoutes()}
        >
          {saving ? "保存中…" : "保存任务分配"}
        </Button>
        <p className="text-muted-foreground text-xs">
          聊天与知识库向量服务分别配置。切换向量模型后需重建文档索引；切换聊天服务不影响向量索引。独立日志
          AI 分析尚无业务入口。
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">最近调用（最多 100 条）</h2>
          <Button
            variant="outline"
            className={button}
            onClick={async () => {
              try {
                const response = await api.get(`${endpoint}/logs`);
                setLogs(response.data);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            刷新记录
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          只保存调用元数据；不记录密钥、提示词或业务正文。Token
          数量以服务实际返回为准。
        </p>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[780px] text-xs">
            <thead className="bg-muted/40">
              <tr>
                {[
                  "时间",
                  "任务",
                  "服务 / 模型",
                  "结果",
                  "耗时",
                  "输入 / 输出 Token",
                  "诊断",
                ].map((t) => (
                  <th className="p-3 text-left" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-border border-t">
                  <td className="p-3">{date(l.created_at)}</td>
                  <td className="p-3">
                    {routes.find((r) => r.task === l.task)?.label ??
                      (
                        {
                          test_chat: "普通测试",
                          test_json: "JSON 测试",
                          test_stream: "流式测试",
                        } as Record<string, string>
                      )[l.task] ??
                      l.task}
                    {l.fallback && "（备用）"}
                  </td>
                  <td className="p-3 break-all">
                    {l.provider_name}
                    <br />
                    <span className="text-muted-foreground">{l.model}</span>
                  </td>
                  <td
                    className={`p-3 ${l.success ? "text-green-600" : "text-red-600"}`}
                  >
                    {l.success ? "成功" : (l.error ?? "失败")}
                  </td>
                  <td className="p-3">{l.elapsed_ms} ms</td>
                  <td className="p-3">
                    {l.input_tokens ?? "—"} / {l.output_tokens ?? "—"}
                  </td>
                  <td className="p-3">
                    <Button
                      className="text-primary whitespace-nowrap hover:underline"
                      onClick={() => setSelectedLog(l)}
                    >
                      详情
                    </Button>
                  </td>
                </tr>
              ))}
              {!logs.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground p-6 text-center"
                  >
                    暂无调用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selectedLog && (
          <div className="border-border bg-muted/20 space-y-3 rounded-xl border p-4">
            <div className="flex justify-between gap-3">
              <h3 className="font-medium">
                调用诊断 · {selectedLog.provider_name} / {selectedLog.model}
              </h3>
              <Button
                variant="outline"
                className={button}
                onClick={() => setSelectedLog(null)}
              >
                关闭详情
              </Button>
            </div>
            <p className="text-xs break-all">
              请求编号：{selectedLog.request_id ?? "历史记录暂无编号"}
            </p>
            {selectedLog.request_id && onInspectRequest && (
              <Button
                variant="outline"
                className={button}
                onClick={() => onInspectRequest(selectedLog.request_id!)}
              >
                查看该请求的应用日志
              </Button>
            )}
            <pre className="max-h-96 overflow-auto text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(selectedLog.diagnostics, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
