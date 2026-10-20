"use client";

import axios from "axios";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/base/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/base/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base/dialog";
import {
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  Field as FormField,
} from "@/components/ui/base/field";
import { Input } from "@/components/ui/base/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/base/input-group";
import { ScrollArea } from "@/components/ui/base/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base/select";
import { Textarea } from "@/components/ui/base/textarea";
import { toast } from "@/components/ui/base/toast";
import api from "@/lib/api";
import {
  type CatalogRecord,
  type Contact,
  type Kind,
  type Option,
  labels,
} from "@/types/catalog";
import {
  CatalogCombobox,
  ConfirmDialog,
  StartDatePicker,
  copyCatalogText,
} from "./catalog-ui";
import { ManagedSelect } from "./managed-select";
import {
  requiredErrors,
  requiredMessage,
  serverFieldErrors,
} from "./record-validation";
import { SearchSelect } from "./search-select";

const genderOptions = [
  { value: "unspecified", label: "未指定" },
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "other", label: "其他" },
];
function GenderSelect({
  value,
  onChange,
  disabled,
  ...control
}: {
  value: Contact["gender"];
  onChange: (value: Contact["gender"]) => void;
  disabled: boolean;
  id?: string;
  "aria-label": string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <Select
      items={genderOptions}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as Contact["gender"]);
      }}
      disabled={disabled}
    >
      <SelectTrigger {...control} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {genderOptions.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
async function copyValue(value: string, label: string) {
  try {
    await copyCatalogText(value);
    toast.add({ title: `${label}已复制到剪贴板`, type: "success" });
  } catch {
    toast.add({ title: "复制失败，请检查浏览器剪贴板权限。", type: "error" });
  }
}

function CopyField({
  value,
  label,
  id,
  "aria-describedby": describedBy,
}: {
  value: string;
  label: string;
  id?: string;
  "aria-describedby"?: string;
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        readOnly
        value={value}
        placeholder="未填写"
        title={value}
        className="min-w-0 truncate"
      />
      <InputGroupAddon align="inline-end" className="shrink-0">
        <InputGroupButton
          size="icon-xs"
          aria-label={`复制${label}`}
          title={`复制${label}`}
          disabled={!value}
          onClick={() => void copyValue(value, label)}
        >
          <Copy />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

const FieldErrorsContext = createContext<Record<string, string>>({});
const normalizedLabel = (label: string) => label.replace(/\s*\*$/, "");
function Field({
  label,
  children,
  errorKey,
  hideLabel,
}: {
  label: string;
  children: ReactNode;
  errorKey?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  const errors = useContext(FieldErrorsContext);
  const error = errors[id] ?? errors[errorKey ?? normalizedLabel(label)];
  if (isValidElement(children)) {
    const control = children as ReactElement<{
      id?: string;
      "aria-invalid"?: boolean;
      "aria-describedby"?: string;
    }>;
    return (
      <FormField
        data-field-key={errorKey ?? normalizedLabel(label)}
        data-invalid={Boolean(error)}
      >
        <FieldLabel htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
          {label}
        </FieldLabel>
        {cloneElement(control, {
          id,
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? `${id}-error` : undefined,
        })}
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </FormField>
    );
  }
  return (
    <FormField>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </FormField>
  );
}
function SuggestionInput({
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  field,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  disabled: boolean;
  field: "model" | "chipset" | "system";
  value: string;
  onChange: (value: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const name = { model: "型号", chipset: "芯片", system: "系统" }[field];
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get(`/api/v1/catalog/suggestions/${field}`, {
          params: { q: query },
          signal: controller.signal,
        })
        .then(({ data }) => setSuggestions(data))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, field, query]);
  return (
    <CatalogCombobox
      id={id}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      label={name}
      value={value ? [value] : []}
      options={suggestions.map((v) => ({ value: v, label: v }))}
      onChange={(next) => onChange(next[0] ?? "")}
      disabled={disabled}
      creatable
      onQueryChange={setQuery}
    />
  );
}
const empty = (): Partial<CatalogRecord> => ({
  company_name: "",
  country_code: "",
  business: [],
  level: "",
  contacts: [],
  notes: "",
  type: "",
  model: "",
  chipset: "",
  system: "",
  repository_url: "",
  fingerprint: "",
  number: "",
  pm: "",
  fae_id: null,
  start_date: "",
  stage: "",
  customer_id: "",
  product_id: "",
});

export function RecordDialog({
  kind,
  record,
  initialDraft,
  startEditing,
  onClose,
  onSaved,
  onDelete,
}: {
  kind: Kind;
  record: CatalogRecord | null;
  initialDraft?: CatalogRecord;
  startEditing?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: (record: CatalogRecord) => void;
}) {
  const [original, setOriginal] = useState(record);
  const [draft, setDraft] = useState<Partial<CatalogRecord>>(
    record ?? initialDraft ?? empty(),
  );
  const [editing, setEditing] = useState(!record || Boolean(startEditing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const focusErrors = useRef(false);
  useEffect(() => {
    if (!focusErrors.current || !Object.keys(fieldErrors).length) return;
    focusErrors.current = false;
    const target = formRef.current?.querySelector<HTMLElement>(
      '[data-invalid="true"] [aria-invalid="true"]',
    );
    target?.focus({ preventScroll: true });
    target?.closest("[data-field-key]")?.scrollIntoView({ block: "nearest" });
  }, [fieldErrors]);
  useEffect(() => {
    const missing = requiredErrors(kind, draft);
    setFieldErrors((current) => {
      const entries = Object.entries(current).filter(
        ([key, message]) => message !== requiredMessage || key in missing,
      );
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
  }, [draft, kind]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [businessOptions, setBusinessOptions] = useState<string[]>([]);
  const [faeOptions, setFaeOptions] = useState<Option[]>([]);
  useEffect(() => {
    if (kind !== "projects") return;
    const controller = new AbortController();
    api
      .get("/api/v1/catalog/fae-options", { signal: controller.signal })
      .then(({ data }) => setFaeOptions(data))
      .catch(() => {
        if (!controller.signal.aborted)
          setError("FAE 选项加载失败，请重新打开窗口后重试。");
      });
    return () => controller.abort();
  }, [kind]);
  const [discardAction, setDiscardAction] = useState<"close" | "cancel">(
    "close",
  );
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(original ?? initialDraft ?? empty());
  useEffect(() => {
    if (kind !== "customers") return;
    const controller = new AbortController();
    api
      .get("/api/v1/catalog/business-options", { signal: controller.signal })
      .then(({ data }) => setBusinessOptions(data))
      .catch(() => {
        if (!controller.signal.aborted)
          setError("业务历史选项加载失败，可继续手动录入。");
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
      disabled={!editing || saving}
      aria-label={label}
      value={String(draft[key] ?? "")}
      onChange={(e) => set(key, e.target.value)}
      autoComplete="off"
      required={required}
      maxLength={maxLength}
    />
  );
  const requestClose = () => {
    if (saving) return;
    if (editing && dirty) {
      setDiscardAction("close");
      setConfirmClose(true);
    } else onClose();
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    const form = e.currentTarget as HTMLFormElement;
    const errors = requiredErrors(kind, draft);
    form
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >("input, textarea")
      .forEach((control) => {
        if (control.disabled || control.readOnly || control.validity.valid)
          return;
        const key =
          control.closest<HTMLElement>("[data-field-key]")?.dataset.fieldKey;
        if (key && !errors[key])
          errors[key] = control.validity.valueMissing
            ? requiredMessage
            : "请检查此字段的填写内容。";
      });
    if (Object.keys(errors).length) {
      focusErrors.current = true;
      setFieldErrors(errors);
      return;
    }
    const keys =
      kind === "customers"
        ? [
            "company_name",
            "country_code",
            "business",
            "level",
            "contacts",
            "notes",
          ]
        : kind === "products"
          ? [
              "type",
              "model",
              "chipset",
              "system",
              "repository_url",
              "fingerprint",
              "notes",
            ]
          : [
              "number",
              "pm",
              "fae_id",
              "start_date",
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
      if (Array.isArray(detail)) {
        const errors = serverFieldErrors(detail);
        focusErrors.current = true;
        setFieldErrors(errors);
        setError(Object.keys(errors).length ? "" : "请检查填写内容。");
      } else {
        setError(
          typeof detail === "string" ? detail : "保存失败，请检查网络后重试。",
        );
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && details.reason !== "close-press") {
            details.cancel();
            return;
          }
          if (!open) requestClose();
        }}
      >
        <DialogContent className="flex max-h-[90dvh] flex-col md:max-w-3xl">
          <DialogHeader className="pr-6">
            <DialogTitle>
              {original ? (editing ? "编辑记录" : "记录预览") : "新建记录"} ·{" "}
              {labels[kind]}
            </DialogTitle>
            <DialogDescription className="break-words">
              {original?.display_name ??
                "填写资料后保存，团队成员即可浏览和引用。"}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            ref={formRef}
            onSubmit={save}
            className="flex min-h-0 flex-col gap-4"
          >
            <ScrollArea className="-mx-4 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [&>[data-slot=scroll-area-viewport]]:min-h-0">
              <div className="px-4 py-1">
                {original?.deleted_at && (
                  <p className="bg-muted text-muted-foreground mb-4 rounded-lg p-3 text-sm">
                    记录已移至最近删除，恢复后才可编辑。
                  </p>
                )}
                <FieldErrorsContext.Provider value={fieldErrors}>
                  <FieldSet disabled={saving}>
                    <FieldGroup>
                      {kind === "customers" && (
                        <>
                          <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
                            <Field label="公司名 *">
                              {text("company_name", "公司名")}
                            </Field>
                            <Field label="客户级别 *">
                              <ManagedSelect
                                category="customer_level"
                                label="客户级别"
                                value={draft.level ?? ""}
                                onChange={(value) => set("level", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            <Field label="国家 / 地区 *">
                              <SearchSelect
                                label="国家 / 地区"
                                value={draft.country_code ?? ""}
                                selectedLabel={draft.country_name ?? ""}
                                url="/api/v1/catalog/locations/countries"
                                disabled={!editing || saving}
                                onChange={(o) =>
                                  setDraft((d) => ({
                                    ...d,
                                    country_code: o.value,
                                    country_name: o.label,
                                  }))
                                }
                              />
                            </Field>
                            <Field label="业务">
                              <CatalogCombobox
                                label="业务"
                                multiple
                                value={draft.business ?? []}
                                options={Array.from(
                                  new Set([
                                    ...businessOptions,
                                    ...(draft.business ?? []),
                                  ]),
                                ).map((v) => ({ value: v, label: v }))}
                                onChange={(next) => {
                                  if (next.length <= 30)
                                    setDraft((d) => ({ ...d, business: next }));
                                }}
                                disabled={!editing || saving}
                              />
                            </Field>
                          </FieldGroup>
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
                                  <Plus data-icon="inline-start" />
                                  添加联系人
                                </Button>
                              )}
                            </div>
                            {!contacts.length && (
                              <p className="text-muted-foreground rounded-lg border border-dashed p-5 text-center text-sm">
                                暂无联系人
                              </p>
                            )}
                            {contacts.map((contact, index) => (
                              <div
                                key={index}
                                className="bg-muted/20 space-y-4 rounded-lg border p-4"
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
                                      <Trash2 data-icon="inline-start" />
                                    </Button>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
                                  <Field
                                    label="姓名 *"
                                    errorKey={`contact-name-${index}`}
                                  >
                                    <Input
                                      disabled={!editing || saving}
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
                                    <GenderSelect
                                      aria-label={`联系人 ${index + 1} 性别`}
                                      value={contact.gender}
                                      onChange={(gender) =>
                                        updateContact(index, {
                                          ...contact,
                                          gender,
                                        })
                                      }
                                      disabled={!editing || saving}
                                    />
                                  </Field>
                                  <Field label="职位">
                                    <Input
                                      disabled={!editing || saving}
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
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium">
                                      联系方式
                                    </span>
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
                                        <Plus data-icon="inline-start" />
                                        添加联系方式
                                      </Button>
                                    )}
                                  </div>
                                  {contact.methods.map((method, mi) => (
                                    <div
                                      key={mi}
                                      className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2"
                                    >
                                      <div className="min-w-0">
                                        <Field
                                          label="通讯工具 *"
                                          hideLabel
                                          errorKey={`contact-tool-${index}-${mi}`}
                                        >
                                          <ManagedSelect
                                            category="contact_method"
                                            label="通讯工具"
                                            placeholder="通讯工具"
                                            required
                                            value={method.type}
                                            disabled={!editing || saving}
                                            onChange={(type) =>
                                              updateContact(index, {
                                                ...contact,
                                                methods: contact.methods.map(
                                                  (m, i) =>
                                                    i === mi
                                                      ? { ...m, type }
                                                      : m,
                                                ),
                                              })
                                            }
                                          />
                                        </Field>
                                      </div>
                                      <Field
                                        label="记录内容 *"
                                        errorKey={`contact-value-${index}-${mi}`}
                                        hideLabel
                                      >
                                        {editing ? (
                                          <Input
                                            disabled={!editing || saving}
                                            aria-label={`联系人 ${index + 1} 方式 ${mi + 1} 内容`}
                                            placeholder="请填写记录"
                                            required
                                            maxLength={2000}
                                            autoComplete="off"
                                            value={method.value}
                                            onChange={(e) =>
                                              updateContact(index, {
                                                ...contact,
                                                methods: contact.methods.map(
                                                  (m, i) =>
                                                    i === mi
                                                      ? {
                                                          ...m,
                                                          value: e.target.value,
                                                        }
                                                      : m,
                                                ),
                                              })
                                            }
                                          />
                                        ) : (
                                          <CopyField
                                            value={method.value}
                                            label={`联系人 ${index + 1} 方式 ${mi + 1} 内容`}
                                          />
                                        )}
                                      </Field>
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
                                          <Trash2 data-icon="inline-start" />
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <Field label="联系人备注">
                                  <Textarea
                                    disabled={!editing || saving}
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
                              disabled={!editing || saving}
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
                          <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
                            <Field label="类型 *">
                              <ManagedSelect
                                category="product_type"
                                label="类型"
                                value={draft.type ?? ""}
                                onChange={(value) => set("type", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            {(["model", "chipset", "system"] as const).map(
                              (f) => (
                                <Field
                                  key={f}
                                  label={`${{ model: "型号", chipset: "芯片", system: "系统" }[f]} *`}
                                >
                                  <SuggestionInput
                                    field={f}
                                    disabled={!editing || saving}
                                    value={draft[f] ?? ""}
                                    onChange={(v) => set(f, v)}
                                  />
                                </Field>
                              ),
                            )}
                          </FieldGroup>
                          {editing && (
                            <>
                              <Field label="固件下载地址">
                                <Input
                                  disabled={!editing || saving}
                                  aria-label="固件下载地址"
                                  type="url"
                                  maxLength={2000}
                                  placeholder="https://…"
                                  value={draft.repository_url}
                                  onChange={(e) =>
                                    set("repository_url", e.target.value)
                                  }
                                />
                              </Field>
                              <Field label="项目指纹">
                                <Textarea
                                  disabled={!editing || saving}
                                  aria-label="项目指纹"
                                  maxLength={10000}
                                  placeholder="输入项目指纹"
                                  value={draft.fingerprint}
                                  onChange={(e) =>
                                    set("fingerprint", e.target.value)
                                  }
                                />
                              </Field>
                            </>
                          )}
                          <Field label="备注">
                            <Textarea
                              disabled={!editing || saving}
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
                          <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
                            <Field label="项目编号 *">
                              {text("number", "项目编号", true, 100)}
                            </Field>
                            <Field label="项目经理（PM）*">
                              <ManagedSelect
                                category="project_pm"
                                label="项目经理"
                                value={draft.pm ?? ""}
                                onChange={(value) => set("pm", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            <Field label="FAE">
                              {editing ? (
                                <CatalogCombobox
                                  label="FAE"
                                  clearable
                                  value={draft.fae_id ? [draft.fae_id] : []}
                                  options={faeOptions}
                                  onChange={(next) =>
                                    setDraft((current) => ({
                                      ...current,
                                      fae_id: next[0] || null,
                                      fae_name:
                                        faeOptions.find(
                                          (option) => option.value === next[0],
                                        )?.label ?? null,
                                    }))
                                  }
                                  disabled={saving}
                                />
                              ) : (
                                <Input
                                  disabled={!editing || saving}
                                  aria-label="FAE"
                                  value={draft.fae_name || "未指定"}
                                  readOnly
                                />
                              )}
                            </Field>
                            <Field label="立项时间 *">
                              <StartDatePicker
                                value={draft.start_date ?? ""}
                                onChange={(value) => set("start_date", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            <Field label="项目阶段 *">
                              <ManagedSelect
                                category="project_stage"
                                label="项目阶段"
                                value={draft.stage ?? ""}
                                onChange={(value) => set("stage", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                          </FieldGroup>
                          <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
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
                          </FieldGroup>
                        </>
                      )}
                    </FieldGroup>
                  </FieldSet>
                </FieldErrorsContext.Provider>
                {kind === "products" && !editing && (
                  <div className="mt-5 grid gap-4">
                    <Field label="固件下载地址">
                      {draft.repository_url &&
                      /^https?:\/\//i.test(draft.repository_url) ? (
                        <a
                          href={draft.repository_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary inline-flex items-center gap-2 text-sm break-all underline-offset-4 hover:underline"
                        >
                          {draft.repository_url}
                          <ExternalLink className="size-4 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          未填写
                        </span>
                      )}
                    </Field>
                    <Field label="项目指纹">
                      <CopyField
                        value={draft.fingerprint ?? ""}
                        label="项目指纹"
                      />
                    </Field>
                  </div>
                )}
                {original && (
                  <Collapsible className="bg-muted/50 mt-6 rounded-lg border">
                    <CollapsibleTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          className="group w-full justify-between"
                        />
                      }
                    >
                      编辑记录
                      <ChevronDown className="transition-transform group-data-open:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <dl className="text-muted-foreground grid grid-cols-2 gap-3 p-4 pt-2 text-xs">
                        <div>
                          <dt>创建人</dt>
                          <dd className="text-foreground mt-1">
                            {original.created_by_name}
                          </dd>
                        </div>
                        <div>
                          <dt>创建时间</dt>
                          <dd className="mt-1">
                            {new Date(original.created_at).toLocaleString(
                              "zh-CN",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>更新人</dt>
                          <dd className="text-foreground mt-1">
                            {original.updated_by_name}
                          </dd>
                        </div>
                        <div>
                          <dt>更新时间</dt>
                          <dd className="mt-1">
                            {new Date(original.updated_at).toLocaleString(
                              "zh-CN",
                            )}
                          </dd>
                        </div>
                      </dl>
                    </CollapsibleContent>
                  </Collapsible>
                )}
                {error && (
                  <p role="alert" className="text-destructive mt-4 text-sm">
                    {error}
                  </p>
                )}
              </div>
            </ScrollArea>
            <DialogFooter>
              {original && !original.deleted_at && !editing && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => onDelete(original)}
                >
                  <Trash2 data-icon="inline-start" />
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
                      if (!original && !dirty) return;
                      if (dirty) {
                        setDiscardAction("cancel");
                        setConfirmClose(true);
                      } else if (original) {
                        setDraft(original);
                        setEditing(false);
                        setError("");
                      }
                    }}
                  >
                    {original ? "取消编辑" : "重置"}
                  </Button>
                  <Button key="save" type="submit" disabled={saving}>
                    {saving && (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    )}
                    保存
                  </Button>
                </>
              ) : (
                <>
                  {!original?.deleted_at && (
                    <Button
                      key="edit"
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setError("");
                      }}
                    >
                      <Pencil data-icon="inline-start" />
                      编辑
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
        <ConfirmDialog
          open={confirmClose}
          title="放弃未保存的修改？"
          description="修改尚未保存。放弃后，这些修改将不会保留。"
          confirmLabel="放弃修改"
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            if (discardAction === "cancel" && original) {
              setDraft(original);
              setEditing(false);
              setError("");
            } else if (discardAction === "cancel" && !original) {
              setDraft(initialDraft ?? empty());
            } else onClose();
          }}
        />
      </Dialog>
    </>
  );
}
