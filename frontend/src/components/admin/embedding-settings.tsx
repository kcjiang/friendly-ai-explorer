"use client";
import { useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";

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
  const t = useUiTranslations();

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
          ? t(
              "ui.serviceChangedRebuildDocumentIndexesInTheKnowledgeBaseKeywordSearchRemains",
            )
          : t("ui.searchServiceChanged"),
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
      setNotice(t("ui.embeddingServiceDeleted"));
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
        t(
          "ui.configurationSavedNewServicesAreNotActivatedAutomaticallyRebuildIndexesAfterChanging",
        ),
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
      const message = `${systemMessage(data.message, t)} (${data.elapsed_ms} ms)`;
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
      <h2 className="font-semibold">{t("ui.knowledgeEmbeddingServices")}</h2>
      <p className="text-muted-foreground text-sm">
        {t(
          "ui.configuredSeparatelyFromChatSaveMultipleServicesAndSelectTheActiveOne",
        )}
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
        {t(
          "ui.useOtherProviderForUnlistedBrandsOrCompatibleGatewaysIncludingBgeOr",
        )}
      </p>
      {active && (
        <div className="space-y-2">
          <label className="block space-y-1 text-sm">
            {t("ui.activeEmbeddingService")}
            <NativeSelect
              className="w-full"
              value={active.active_profile_id ?? ""}
              disabled={busy || !!config}
              onChange={(e) => void activate(e.target.value)}
            >
              <option value="">{t("ui.keywordSearchOnly")}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </NativeSelect>
          </label>
          {active.protocol !== "disabled" && (
            <p className="text-muted-foreground text-xs">
              {t("ui.indexesReady")}
              {active.indexed_documents} / {active.published_documents}{" "}
              {t("ui.documents")}
              {active.reindex_required
                ? t(
                    "ui.rebuildIndexesContentWithoutAReadyIndexUsesKeywordSearch",
                  )
                : ""}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {t("ui.savedEmbeddingServices")}
        </h3>
        <Button
          variant="outline"
          disabled={busy || !!config}
          onClick={() => edit()}
        >
          {t("ui.addEmbeddingService")}
        </Button>
      </div>
      {!profiles.length && (
        <p className="text-muted-foreground text-sm">
          {t("ui.noEmbeddingServicesYetKeywordSearchIsActive")}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((p) => (
          <div key={p.id} className="min-w-0 space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium break-all">{p.name}</h4>
              {p.id === active?.active_profile_id && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t("ui.active")}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs break-all">
              {p.model} ·{" "}
              {p.protocol === "gemini"
                ? "Google Gemini Embedding API"
                : t("ui.openaiCompatibleEmbeddings")}
              <br />
              {p.base_url}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("ui.key")}
              {p.has_api_key ? t("ui.encrypted") : t("ui.notConfigured")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!config}
                onClick={() => edit(p)}
              >
                {t("ui.edit")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!config}
                onClick={() => void test(p.id)}
              >
                {t("ui.test")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy || !!config || p.id === active?.active_profile_id
                }
                onClick={() => void activate(p.id)}
              >
                {t("ui.useThisService")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy || !!config || p.id === active?.active_profile_id
                }
                onClick={() => setDeleting(p)}
              >
                {t("ui.delete")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {config && (
        <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
          <fieldset disabled={busy} className="space-y-4">
            <h3 className="text-sm font-medium">
              {config.id
                ? t("ui.editEmbeddingService")
                : t("ui.addEmbeddingService")}
            </h3>
            <label className="block space-y-1 text-sm">
              {t("ui.embeddingServiceName")}
              <Input
                required
                maxLength={100}
                value={config.name}
                onChange={(e) => change({ name: e.target.value })}
                placeholder={t("ui.eGQwenEmbeddingService")}
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1 text-sm">
                {t("ui.provider")}
                <NativeSelect
                  className="w-full"
                  value={config.vendor}
                  onChange={(e) =>
                    change({ vendor: e.target.value as Config["vendor"] })
                  }
                >
                  <option value="other">
                    {t("ui.otherProviderCompatibleApi")}
                  </option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="qwen">Qwen</option>
                </NativeSelect>
              </label>
              <label className="space-y-1 text-sm">
                {t("ui.apiType")}
                <NativeSelect
                  className="w-full"
                  disabled={busy}
                  value={config.protocol}
                  onChange={(e) =>
                    change({ protocol: e.target.value as Config["protocol"] })
                  }
                >
                  <option value="openai">
                    {t("ui.openaiCompatibleEmbeddings")}
                  </option>
                  <option value="gemini">Google Gemini Embedding API</option>
                </NativeSelect>
              </label>
              <label className="space-y-1 text-sm">
                {t("ui.model")}
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
                  placeholder={t("ui.httpYourEmbeddingServerPortV1")}
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
                      ? t(
                          "ui.configuredLeaveBlankToKeepChangingUrlOrProtocolClearsTheOld",
                        )
                      : t("ui.leaveBlankForLocalApisWithoutAuthentication")
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                {t("ui.timeoutSeconds")}
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
                {t("ui.queryPrefix")}
                <Input
                  className={input}
                  maxLength={300}
                  value={config.query_prefix}
                  onChange={(e) => change({ query_prefix: e.target.value })}
                  placeholder={t("ui.followTheModelDocumentationOptional")}
                />
              </label>
              <label className="space-y-1 text-sm">
                {t("ui.documentPrefix")}
                <Input
                  className={input}
                  maxLength={300}
                  value={config.document_prefix}
                  onChange={(e) => change({ document_prefix: e.target.value })}
                  placeholder={t("ui.followTheModelDocumentationOptional")}
                />
              </label>
              <label className="space-y-1 text-sm">
                {t("ui.minimumVectorSimilarity")}
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
                  {t("ui.requestDimensions768IfSupported")}
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
                {t("ui.clearSavedKey")}
              </label>
            </div>
            <p className="text-muted-foreground text-xs">
              {t("ui.testsUseTheSavedConfigurationAndNeverReturnVectorsOrKeys")}
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="outline"
                className={button}
                disabled={busy}
              >
                {t("ui.saveEmbeddingService")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={button}
                disabled={busy || dirty || !config.id}
                onClick={() => config.id && void test(config.id)}
              >
                {t("ui.testEmbeddingService")}
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
                {t("ui.cancel")}
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
            <AlertDialogTitle>
              {t("ui.deleteEmbeddingService")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("ui.delete2")}
              {deleting?.name}
              {t("ui.andItsSavedCredentialsKnowledgeDocumentsWillBeRetained")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              {t("ui.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => deleting && void remove(deleting)}
            >
              {t("ui.confirmDeletion")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
