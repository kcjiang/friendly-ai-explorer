"use client";

import axios from "axios";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import {
  type CatalogRecord,
  type Contact,
  type Kind,
  type Option,
  labels,
} from "@/types/catalog";
import { SearchSelect } from "./search-select";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
function SuggestionInput({
  field,
  value,
  onChange,
}: {
  field: "model" | "chipset" | "system";
  value: string;
  onChange: (value: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const name = { model: "型号", chipset: "芯片", system: "系统" }[field];
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get(`/api/v1/catalog/suggestions/${field}`, {
          params: { q: value },
          signal: controller.signal,
        })
        .then(({ data }) => setSuggestions(data))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [field, value]);
  return (
    <>
      <Input
        aria-label={name}
        required
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={`suggest-${field}`}
        autoComplete="off"
      />
      <datalist id={`suggest-${field}`}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
const empty = (): Partial<CatalogRecord> => ({
  company_name: "",
  country_code: "",
  city_id: "",
  level: "SMB",
  contacts: [],
  notes: "",
  type: "OTT",
  model: "",
  chipset: "",
  system: "",
  repository_url: "",
  number: "",
  pm: "",
  start_month: "",
  stage: "EV",
  customer_id: "",
  product_id: "",
});

export function RecordDialog({
  kind,
  record,
  onClose,
  onSaved,
  onDelete,
}: {
  kind: Kind;
  record: CatalogRecord | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: (record: CatalogRecord) => void;
}) {
  const [original, setOriginal] = useState(record);
  const [draft, setDraft] = useState<Partial<CatalogRecord>>(record ?? empty());
  const [editing, setEditing] = useState(!record);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [countries, setCountries] = useState<Option[]>([]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original ?? empty());
  useEffect(() => {
    if (kind !== "customers") return;
    const controller = new AbortController();
    api
      .get("/api/v1/catalog/locations/countries", { signal: controller.signal })
      .then(({ data }) => setCountries(data))
      .catch(() => {
        if (!controller.signal.aborted)
          setError("国家列表加载失败，请关闭后重试。");
      });
    return () => controller.abort();
  }, [kind]);
  const set = (key: keyof CatalogRecord, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const contacts = draft.contacts ?? [];
  const updateContact = (index: number, value: Contact) =>
    setDraft((d) => ({
      ...d,
      contacts: contacts.map((c, i) => (i === index ? value : c)),
    }));
  const text = (
    key: keyof CatalogRecord,
    label: string,
    required = true,
    maxLength = 200,
  ) => (
    <Input
      aria-label={label}
      value={String(draft[key] ?? "")}
      onChange={(e) => set(key, e.target.value)}
      autoComplete="off"
      required={required}
      maxLength={maxLength}
    />
  );
  const select = (
    key: keyof CatalogRecord,
    label: string,
    options: string[],
  ) => (
    <NativeSelect
      aria-label={label}
      value={String(draft[key] ?? "")}
      onChange={(e) => set(key, e.target.value)}
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </NativeSelect>
  );
  const requestClose = () => {
    if (saving) return;
    if (editing && dirty) setConfirmClose(true);
    else onClose();
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (kind === "customers" && (!draft.country_code || !draft.city_id)) {
      setError("请选择国家和城市。");
      return;
    }
    if (kind === "projects" && (!draft.customer_id || !draft.product_id)) {
      setError("请选择客户和产品，请先在对应库中新建记录。");
      return;
    }
    const keys =
      kind === "customers"
        ? [
            "company_name",
            "country_code",
            "city_id",
            "level",
            "contacts",
            "notes",
          ]
        : kind === "products"
          ? ["type", "model", "chipset", "system", "repository_url", "notes"]
          : [
              "number",
              "pm",
              "start_month",
              "stage",
              "customer_id",
              "product_id",
            ];
    const body = Object.fromEntries(
      keys.map((k) => [k, draft[k as keyof CatalogRecord]]),
    );
    setSaving(true);
    try {
      const { data } = original
        ? await api.put(`/api/v1/catalog/${kind}/${original.id}`, {
            ...body,
            revision: original.revision,
          })
        : await api.post(`/api/v1/catalog/${kind}`, body);
      setOriginal(data);
      setDraft(data);
      setEditing(false);
      onSaved();
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? err.response?.data?.detail
        : null;
      setError(
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? `请检查填写内容：${detail.map((d: { loc?: string[]; msg?: string }) => `${d.loc?.join(".")}: ${d.msg}`).join("；")}`
            : "保存失败，请检查网络后重试。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (saving || (editing && dirty)) {
            e.preventDefault();
            requestClose();
          }
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
      >
        <div className="border-b px-6 py-5 pr-12">
          <DialogTitle className="text-lg font-semibold">
            {original ? (editing ? "编辑记录" : "记录预览") : "新建记录"} ·{" "}
            {labels[kind]}
          </DialogTitle>
          <DialogDescription className="mt-1 truncate text-sm text-muted-foreground">
            {original?.display_name ??
              "填写资料后保存，团队成员即可浏览和引用。"}
          </DialogDescription>
        </div>
        <form onSubmit={save} className="flex min-h-0 flex-col">
          <div className="overflow-y-auto px-6 py-5">
            {original?.deleted_at && (
              <p className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                记录已移至最近删除，恢复后才可编辑。
              </p>
            )}
            <fieldset
              disabled={!editing || saving}
              className="grid gap-5 disabled:opacity-90"
            >
              {kind === "customers" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="公司名 *">
                      {text("company_name", "公司名")}
                    </Field>
                    <Field label="客户级别 *">
                      {select("level", "客户级别", ["KA", "LA", "SMB"])}
                    </Field>
                    <Field label="国家 / 地区 *">
                      <NativeSelect
                        aria-label="国家"
                        required
                        value={draft.country_code}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            country_code: e.target.value,
                            city_id: "",
                            city_name: "",
                          }))
                        }
                      >
                        <option value="">选择国家 / 地区</option>
                        {countries.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="城市 *">
                      <SearchSelect
                        label="城市"
                        value={draft.city_id ?? ""}
                        selectedLabel={draft.city_name ?? ""}
                        url={`/api/v1/catalog/locations/cities?country=${draft.country_code}`}
                        disabled={!editing || !draft.country_code || saving}
                        onChange={(o) =>
                          setDraft((d) => ({
                            ...d,
                            city_id: o.value,
                            city_name: o.label,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">
                        联系人{" "}
                        <span className="text-muted-foreground">
                          ({contacts.length})
                        </span>
                      </h3>
                      {editing && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={contacts.length >= 100}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              contacts: [
                                ...contacts,
                                {
                                  name: "",
                                  gender: "unspecified",
                                  position: "",
                                  methods: [],
                                  notes: "",
                                },
                              ],
                            }))
                          }
                        >
                          <Plus />
                          添加联系人
                        </Button>
                      )}
                    </div>
                    {!contacts.length && (
                      <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                        暂无联系人
                      </p>
                    )}
                    {contacts.map((contact, index) => (
                      <div
                        key={index}
                        className="space-y-4 rounded-lg border bg-muted/20 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium">
                            联系人 {index + 1}
                          </h4>
                          {editing && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`删除联系人 ${index + 1}`}
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  contacts: contacts.filter(
                                    (_, i) => i !== index,
                                  ),
                                }))
                              }
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="姓名 *">
                            <Input
                              aria-label={`联系人 ${index + 1} 姓名`}
                              required
                              maxLength={200}
                              autoComplete="off"
                              value={contact.name}
                              onChange={(e) =>
                                updateContact(index, {
                                  ...contact,
                                  name: e.target.value,
                                })
                              }
                            />
                          </Field>
                          <Field label="性别">
                            <NativeSelect
                              aria-label={`联系人 ${index + 1} 性别`}
                              value={contact.gender}
                              onChange={(e) =>
                                updateContact(index, {
                                  ...contact,
                                  gender: e.target.value as Contact["gender"],
                                })
                              }
                            >
                              <option value="unspecified">未指定</option>
                              <option value="male">男</option>
                              <option value="female">女</option>
                              <option value="other">其他</option>
                            </NativeSelect>
                          </Field>
                          <Field label="职位">
                            <Input
                              aria-label={`联系人 ${index + 1} 职位`}
                              maxLength={200}
                              autoComplete="off"
                              value={contact.position}
                              onChange={(e) =>
                                updateContact(index, {
                                  ...contact,
                                  position: e.target.value,
                                })
                              }
                            />
                          </Field>
                        </div>
                        <div className="space-y-2">
                          <span className="text-sm font-medium">联系方式</span>
                          {contact.methods.map((method, mi) => (
                            <div key={mi} className="flex gap-2">
                              <Input
                                aria-label={`联系人 ${index + 1} 方式 ${mi + 1} 类型`}
                                placeholder="Email / MSTeams / Slack"
                                required
                                maxLength={100}
                                autoComplete="off"
                                className="w-2/5"
                                value={method.type}
                                onChange={(e) =>
                                  updateContact(index, {
                                    ...contact,
                                    methods: contact.methods.map((m, i) =>
                                      i === mi
                                        ? { ...m, type: e.target.value }
                                        : m,
                                    ),
                                  })
                                }
                              />
                              <Input
                                aria-label={`联系人 ${index + 1} 方式 ${mi + 1} 内容`}
                                placeholder="地址、链接或群组名称"
                                required
                                maxLength={2000}
                                autoComplete="off"
                                value={method.value}
                                onChange={(e) =>
                                  updateContact(index, {
                                    ...contact,
                                    methods: contact.methods.map((m, i) =>
                                      i === mi
                                        ? { ...m, value: e.target.value }
                                        : m,
                                    ),
                                  })
                                }
                              />
                              {editing && (
                                <Button
                                  aria-label={`删除联系人 ${index + 1} 方式 ${mi + 1}`}
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    updateContact(index, {
                                      ...contact,
                                      methods: contact.methods.filter(
                                        (_, i) => i !== mi,
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </div>
                          ))}
                          {editing && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={contact.methods.length >= 30}
                              onClick={() =>
                                updateContact(index, {
                                  ...contact,
                                  methods: [
                                    ...contact.methods,
                                    { type: "", value: "" },
                                  ],
                                })
                              }
                            >
                              <Plus />
                              添加联系方式
                            </Button>
                          )}
                        </div>
                        <Field label="联系人备注">
                          <Textarea
                            aria-label={`联系人 ${index + 1} 备注`}
                            maxLength={10000}
                            autoComplete="off"
                            placeholder="沟通习惯、偏好等"
                            value={contact.notes}
                            onChange={(e) =>
                              updateContact(index, {
                                ...contact,
                                notes: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                    ))}
                  </div>
                  <Field label="公司备注">
                    <Textarea
                      aria-label="公司备注"
                      maxLength={10000}
                      autoComplete="off"
                      value={draft.notes}
                      onChange={(e) => set("notes", e.target.value)}
                    />
                  </Field>
                </>
              )}
              {kind === "products" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="类型 *">
                      {select("type", "类型", ["OTT", "IPC", "NetCom"])}
                    </Field>
                    {(["model", "chipset", "system"] as const).map((f) => (
                      <Field
                        key={f}
                        label={`${{ model: "型号", chipset: "芯片", system: "系统" }[f]} *`}
                      >
                        <SuggestionInput
                          field={f}
                          value={draft[f] ?? ""}
                          onChange={(v) => set(f, v)}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="软件库链接">
                    <Input
                      aria-label="软件库链接"
                      type="url"
                      maxLength={2000}
                      placeholder="https://…"
                      autoComplete="off"
                      value={draft.repository_url}
                      onChange={(e) => set("repository_url", e.target.value)}
                    />
                  </Field>
                  <Field label="备注">
                    <Textarea
                      aria-label="产品备注"
                      autoComplete="off"
                      maxLength={10000}
                      value={draft.notes}
                      onChange={(e) => set("notes", e.target.value)}
                    />
                  </Field>
                </>
              )}
              {kind === "projects" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="项目编号 *">
                      {text("number", "项目编号", true, 100)}
                    </Field>
                    <Field label="项目经理（PM）*">
                      {text("pm", "项目经理", true, 100)}
                    </Field>
                    <Field label="立项时间 *">
                      <Input
                        aria-label="立项时间"
                        type="month"
                        min="1000-01"
                        max="9999-12"
                        required
                        value={draft.start_month}
                        onChange={(e) => set("start_month", e.target.value)}
                      />
                    </Field>
                    <Field label="项目阶段 *">
                      {select("stage", "项目阶段", [
                        "EV",
                        "EVT",
                        "DVT",
                        "PVT",
                        "MR",
                        "MP",
                      ])}
                    </Field>
                  </div>
                  <Field label="客户 *">
                    <SearchSelect
                      label="客户"
                      kind="catalog"
                      value={draft.customer_id ?? ""}
                      selectedLabel={draft.customer_name ?? ""}
                      url="/api/v1/catalog/customers"
                      disabled={!editing || saving}
                      onChange={(o) =>
                        setDraft((d) => ({
                          ...d,
                          customer_id: o.value,
                          customer_name: o.label,
                        }))
                      }
                    />
                  </Field>
                  <Field label="产品 *">
                    <SearchSelect
                      label="产品"
                      kind="catalog"
                      value={draft.product_id ?? ""}
                      selectedLabel={draft.product_name ?? ""}
                      url="/api/v1/catalog/products"
                      disabled={!editing || saving}
                      onChange={(o) =>
                        setDraft((d) => ({
                          ...d,
                          product_id: o.value,
                          product_name: o.label,
                        }))
                      }
                    />
                  </Field>
                </>
              )}
            </fieldset>
            {original && (
              <dl className="mt-6 grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground">
                <div>
                  <dt>创建人</dt>
                  <dd className="mt-1 text-foreground">
                    {original.created_by_name}
                  </dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd className="mt-1">
                    {new Date(original.created_at).toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>更新人</dt>
                  <dd className="mt-1 text-foreground">
                    {original.updated_by_name}
                  </dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd className="mt-1">
                    {new Date(original.updated_at).toLocaleString("zh-CN")}
                  </dd>
                </div>
              </dl>
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
            {confirmClose && (
              <div role="alert" className="mt-4 rounded-lg border p-4 text-sm">
                <p>尚有未保存的修改，是否放弃？</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmClose(false)}
                  >
                    继续编辑
                  </Button>
                  <Button type="button" variant="destructive" onClick={onClose}>
                    放弃修改
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            {original && !original.deleted_at && !editing && onDelete && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                onClick={() => onDelete(original)}
              >
                <Trash2 />
                删除
              </Button>
            )}
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    if (original) {
                      setDraft(original);
                      setEditing(false);
                      setError("");
                      setConfirmClose(false);
                    } else requestClose();
                  }}
                >
                  取消
                </Button>
                <Button
                  key="save"
                  type="submit"
                  disabled={saving}
                  className="text-white"
                >
                  {saving && <Loader2 className="animate-spin" />}保存
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={onClose}>
                  关闭
                </Button>
                {!original?.deleted_at && (
                  <Button
                    key="edit"
                    type="button"
                    className="text-white"
                    onClick={() => {
                      setEditing(true);
                      setError("");
                    }}
                  >
                    <Pencil />
                    编辑
                  </Button>
                )}
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
