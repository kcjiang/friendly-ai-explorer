"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { NativeSelect } from "@/components/ui/base/native-select";
import { getBrowserUiLocale } from "@/i18n/browser";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";
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
  other: "Other provider (compatible API)",
};
const protocols = {
  openai: "OpenAI Chat Completions",
  responses: "OpenAI Responses",
  gemini: "Google Gemini API",
};
const capabilityLabels: Record<string, string> = {
  text: "Text generation",
  conversation: "Multi-turn conversation",
  json: "Structured JSON",
  stream: "Streaming",
};
const statusLabels: Record<string, string> = {
  verified: "Verified",
  unsupported: "Unsupported",
  unknown: "Unverified",
};
const endpoint = "/api/v1/admin/ai";
const date = (value: string) =>
  new Date(value).toLocaleString(getBrowserUiLocale());

export default function AISettings({
  onInspectRequest,
}: {
  onInspectRequest?: (id: string) => void;
}) {
  const t = useUiTranslations();
  const localizedFresh = translateLabels(fresh, t);
  const localizedVendors = translateLabels(vendors, t);
  const localizedCapabilityLabels = translateLabels(capabilityLabels, t);
  const localizedStatusLabels = translateLabels(statusLabels, t);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null | undefined>();
  const [draft, setDraft] = useState<Draft>(localizedFresh);
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
        : { ...localizedFresh },
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
      setDraft({ ...localizedFresh });
      setNotice(
        t("ui.serviceSavedVerifyTheRequiredCapabilitiesBeforeAssigningTasks"),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  async function remove(provider: Provider) {
    if (!confirm(t("dynamic.deleteAiService", { p0: provider.name }))) return;
    setBusy(provider.id);
    setError("");
    setNotice("");
    try {
      await api.delete(`${endpoint}/providers/${provider.id}`);
      setProviders((prev) => prev.filter((p) => p.id !== provider.id));
      setNotice(t("ui.serviceDeleted"));
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
          t(
            "ui.theServiceConfigurationChangedDuringTestingThisResultAppliesToTheEarlier",
          ),
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
      setNotice(t("ui.taskAssignmentsSavedNewRequestsUseThemImmediately"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  const enabled = providers.filter((p) => p.enabled);
  const defaultRoute = routes.find((r) => r.task === "default");
  const providerName = (id: string | null | undefined) =>
    providers.find((p) => p.id === id)?.name ?? t("ui.notConfigured");
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
          {t("ui.manageServicesTestModelsAndAssignAiToTasksSavedSettingsApply")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className={button}
            disabled={saving || !!busy}
            onClick={() => {
              if (
                !dirty ||
                confirm(
                  t("ui.refreshingWillDiscardUnsavedTaskAssignmentsContinue"),
                )
              )
                void load();
            }}
          >
            <RefreshCw size={14} className="mr-1 inline" />
            {t("ui.refresh")}
          </Button>
          <Button
            className={primary}
            disabled={saving || !!busy}
            onClick={() => edit()}
          >
            <Plus size={14} className="mr-1 inline" />
            {t("ui.addService")}
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
            {editing ? t("ui.editAiService") : t("ui.addAiService")}
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
            {t("ui.applyLowLatencySettings")}
          </Button>
          <p className="text-muted-foreground text-xs">
            {t("ui.useOtherProviderForUnlistedBrandsOrApiGatewaysSelectTheApi")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t(
              "ui.tasksAreAssignedManuallyAutoModeDisablesThinkingForClassicQwen3And",
            )}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1 text-sm">
              {t("ui.provider")}
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
                {Object.entries(localizedVendors).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="block space-y-1 text-sm">
              {t("ui.serviceName")}
              <Input
                required
                maxLength={100}
                className={input}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("ui.eGQwenService")}
              />
            </label>
            <label className="block space-y-1 text-sm">
              {t("ui.apiType")}
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
              {t("ui.authentication")}
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
                <option value="none">{t("ui.noAuthentication")}</option>
              </NativeSelect>
            </label>
            {draft.protocol === "openai" && (
              <label className="block space-y-1 text-sm">
                {t("ui.outputLengthParameter")}
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
                placeholder={t("ui.httpsYourServiceV1")}
              />
            </label>
            <label className="block space-y-1 text-sm">
              {t("ui.modelName")}
              <Input
                required
                maxLength={200}
                className={input}
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder={t("ui.enterTheModelIdProvidedByTheService")}
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
                    ? t("ui.leaveBlankToKeepTheKeyChangingTheApiTypeRequiresA")
                    : t("ui.enterAnApiKeyEncryptedByTheBackend")
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              {t("ui.timeoutSeconds")}
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
              {t("ui.maximumOutputTokens")}
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
              {t("ui.maximumConcurrencyPerBackendProcess")}
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
              {t("ui.thinkingMode")}
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
                <option value="auto">{t("ui.autoCompatibility")}</option>
                <option value="off">
                  {t("ui.disableThinkingRequiresApiSupport")}
                </option>
                <option value="on">
                  {t("ui.enableThinkingRequiresApiSupport")}
                </option>
              </NativeSelect>
            </label>
            <label className="block space-y-1 text-sm">
              {t("ui.structuredOutput")}
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
                <option value="auto">{t("ui.autoSchemaJsonPrompt")}</option>
                <option value="schema">{t("ui.requireJsonSchema")}</option>
                <option value="object">{t("ui.jsonObjectMode")}</option>
                <option value="off">{t("ui.promptConstraintsOnly")}</option>
              </NativeSelect>
            </label>
            <label className="block space-y-1 text-sm">
              {t("ui.temperatureBlankForModelDefault")}
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
              {t("ui.retriesForTransientFailures")}
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
              {t("ui.enableService")}
            </label>
          </div>
          {draft.base_url.startsWith("http://") && (
            <p className="text-xs text-amber-600">
              {t(
                "ui.httpSendsKeysAndRequestsWithoutEncryptionUseHttpsForPublicNetworks",
              )}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving} className={primary}>
              {saving ? t("ui.saving2") : t("ui.saveService")}
            </Button>
            <Button
              type="button"
              disabled={saving}
              variant="outline"
              className={button}
              onClick={() => {
                setEditing(undefined);
                setDraft({ ...localizedFresh });
              }}
            >
              {t("ui.cancel")}
            </Button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">{t("ui.aiServices")}</h2>
        <p className="text-muted-foreground text-xs">
          {t("ui.eachCapabilityTestCallsTheModelAndIncursASmallInferenceCost")}
        </p>
        {!providers.length && (
          <p className="text-muted-foreground text-sm">
            {t("ui.noAiServicesConfiguredAddAServiceEnterAnApiKeyTest")}
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
                  {p.enabled ? t("ui.enabled") : t("ui.disabled")}
                </span>
              </div>
              <p className="text-muted-foreground text-xs break-all">
                {localizedVendors[p.vendor]} · {protocols[p.protocol]} ·{" "}
                {p.model}
                <br />
                {p.base_url}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("ui.key")}
                {p.has_api_key ? t("ui.encrypted") : t("ui.notConfigured")}{" "}
                {t("ui.timeout")} {p.timeout_seconds}
                {t("ui.sOutput")}
                {p.max_output_tokens} {t("ui.tokensConcurrency")}{" "}
                {p.max_concurrency}
              </p>
              <p
                className={`text-xs ${p.last_test_ok === false ? "text-red-600" : "text-muted-foreground"}`}
              >
                {p.last_test_at
                  ? t("dynamic.lastTest", {
                      p0: date(p.last_test_at),
                      p1: p.last_test_ok ? t("ui.success") : t("ui.failed2"),
                      p2: p.last_test_message
                        ? systemMessage(p.last_test_message, t)
                        : "",
                    })
                  : t("ui.thisConfigurationHasNotBeenTested")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className={button}
                  disabled={saving || !!busy}
                  onClick={() => edit(p)}
                >
                  {t("ui.edit")}
                </Button>
                <Button
                  variant="outline"
                  className={button}
                  disabled={saving || !!busy}
                  onClick={() => void remove(p)}
                >
                  {t("ui.delete")}
                </Button>
                <NativeSelect
                  aria-label={t("dynamic.testType", { p0: p.name })}
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
                  <option value="chat">{t("ui.textResponse")}</option>
                  <option value="json">{t("ui.jsonOutput")}</option>
                  <option value="stream">{t("ui.streaming")}</option>
                  <option value="conversation">
                    {t("ui.multiTurnConversation")}
                  </option>
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
                      {t("ui.processing")}
                    </>
                  ) : (
                    t("ui.testConnection")
                  )}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(localizedCapabilityLabels).map(
                  ([id, label]) => {
                    const check = p.capability_checks?.[id];
                    return (
                      <span
                        key={id}
                        className="rounded border px-2 py-1"
                        title={
                          check?.tested_at
                            ? date(check.tested_at)
                            : t("ui.runTheCorrespondingCapabilityTest")
                        }
                      >
                        {label}：
                        {localizedStatusLabels[check?.status ?? "unknown"]}
                      </span>
                    );
                  },
                )}
              </div>
              {results[p.id] && (
                <div
                  className="bg-muted/40 space-y-2 rounded-lg p-3 text-xs"
                  role="status"
                >
                  <p>
                    {systemMessage(results[p.id].message, t)} ·{" "}
                    {results[p.id].elapsed_ms} ms · {results[p.id].model}
                  </p>
                  {results[p.id].reply && (
                    <pre className="break-all whitespace-pre-wrap">
                      {results[p.id].reply}
                    </pre>
                  )}
                  <details>
                    <summary className="cursor-pointer">
                      {t("ui.testDiagnostics")}
                    </summary>
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
          {t("ui.taskAssignments")}{" "}
          {dirty && (
            <span className="text-xs text-amber-600">{t("ui.unsaved")}</span>
          )}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t(
            "ui.tasksFollowingTheDefaultInheritItsFallbackTasksWithAnExplicitPrimary",
          )}
        </p>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                {[
                  t("ui.task"),
                  t("ui.primaryService"),
                  t("ui.fallbackService"),
                  t("ui.timeoutSeconds"),
                  t("ui.outputTokens"),
                ].map((t) => (
                  <th key={t} className="p-3 text-left font-medium">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.task} className="border-border border-t">
                  <td className="p-3">
                    <p className="font-medium">{translateLabels(r.label, t)}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t("ui.required")}
                      {r.requirements
                        .map((c) => translateLabels(c.label, t))
                        .join(", ")}
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
                              ? t("ui.verificationNeeded") +
                                missing
                                  .map((c) => translateLabels(c.label, t))
                                  .join(", ")
                              : t("ui.requirementsMet")}
                          </p>
                        );
                      })}
                    {r.task !== "default" && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("ui.effective")}
                        {providerName(
                          r.provider_id || defaultRoute?.provider_id,
                        )}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <NativeSelect
                      aria-label={t("dynamic.primaryService", { p0: r.label })}
                      className={input}
                      value={r.provider_id ?? ""}
                      onChange={(e) =>
                        changeRoute(r.task, {
                          provider_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">
                        {r.task === "default"
                          ? t("ui.notConfigured")
                          : t("ui.followDefault")}
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
                      aria-label={t("dynamic.fallbackService", { p0: r.label })}
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
                          ? t("ui.followDefaultFallback")
                          : t("ui.noFallback")}
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
                      aria-label={t("dynamic.timeout", { p0: r.label })}
                      type="number"
                      min={5}
                      max={300}
                      placeholder={t("ui.inherit")}
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
                      aria-label={t("dynamic.outputLimit", { p0: r.label })}
                      type="number"
                      min={16}
                      max={65536}
                      placeholder={t("ui.inherit")}
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
          {saving ? t("ui.saving2") : t("ui.saveTaskAssignments")}
        </Button>
        <p className="text-muted-foreground text-xs">
          {t(
            "ui.chatAndKnowledgeEmbeddingsAreConfiguredSeparatelyRebuildDocumentIndexesAfterChanging",
          )}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("ui.recentCallsUpTo100")}</h2>
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
            {t("ui.refreshCalls")}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t(
            "ui.onlyCallMetadataIsSavedExcludingKeysPromptsAndBusinessContentToken",
          )}
        </p>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[780px] text-xs">
            <thead className="bg-muted/40">
              <tr>
                {[
                  t("ui.time"),
                  t("ui.task"),
                  t("ui.serviceModel"),
                  t("ui.result"),
                  t("ui.duration"),
                  t("ui.inputOutputTokens"),
                  t("ui.diagnostics"),
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
                          test_chat: t("ui.textTest"),
                          test_json: t("ui.jsonTest"),
                          test_stream: t("ui.streamingTest"),
                        } as Record<string, string>
                      )[l.task] ??
                      l.task}
                    {l.fallback && t("ui.fallback")}
                  </td>
                  <td className="p-3 break-all">
                    {l.provider_name}
                    <br />
                    <span className="text-muted-foreground">{l.model}</span>
                  </td>
                  <td
                    className={`p-3 ${l.success ? "text-green-600" : "text-red-600"}`}
                  >
                    {l.success ? t("ui.success") : (l.error ?? t("ui.failed2"))}
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
                      {t("ui.details")}
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
                    {t("ui.noCallsYet")}
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
                {t("ui.callDiagnostics")}
                {selectedLog.provider_name} / {selectedLog.model}
              </h3>
              <Button
                variant="outline"
                className={button}
                onClick={() => setSelectedLog(null)}
              >
                {t("ui.closeDetails")}
              </Button>
            </div>
            <p className="text-xs break-all">
              {t("ui.requestId")}
              {selectedLog.request_id ?? t("ui.noIdInThisHistoricalRecord")}
            </p>
            {selectedLog.request_id && onInspectRequest && (
              <Button
                variant="outline"
                className={button}
                onClick={() => onInspectRequest(selectedLog.request_id!)}
              >
                {t("ui.viewApplicationLogsForThisRequest")}
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
