"use client";
import { useLocale } from "next-intl";

import {
  useUiTranslations,
  translateLabels,
  type UiTranslator,
} from "@/i18n/client";
import { errorMessage } from "@/lib/errors";

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
  fieldLabels,
  requiredMessage,
  serverFieldErrors,
} from "./record-validation";
import { SearchSelect } from "./search-select";

const genderOptions = [
  { value: "unspecified", label: "Unspecified" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
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
  const t = useUiTranslations();
  const uiLabels_genderOptions = translateLabels(genderOptions, t);
  return (
    <Select
      items={uiLabels_genderOptions}
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
          {uiLabels_genderOptions.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
async function copyValue(value: string, label: string, t: UiTranslator) {
  try {
    await copyCatalogText(value);
    toast.add({
      title: t("dynamic.copiedToClipboard", { p0: label }),
      type: "success",
    });
  } catch {
    toast.add({
      title: t("ui.copyFailedCheckClipboardPermissions"),
      type: "error",
    });
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
  const t = useUiTranslations();

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        readOnly
        value={value}
        placeholder={t("ui.notProvided")}
        title={value}
        className="min-w-0 truncate"
      />
      <InputGroupAddon align="inline-end" className="shrink-0">
        <InputGroupButton
          size="icon-xs"
          aria-label={t("dynamic.copy", { p0: label })}
          title={t("dynamic.copy", { p0: label })}
          disabled={!value}
          onClick={() => void copyValue(value, label, t)}
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
  const t = useUiTranslations();
  const canonicalLabel =
    Object.values(fieldLabels).find(
      (value) => translateLabels(value, t) === normalizedLabel(label),
    ) ?? normalizedLabel(label);
  const id = useId();
  const errors = useContext(FieldErrorsContext);
  const error = errors[id] ?? errors[errorKey ?? canonicalLabel];
  if (isValidElement(children)) {
    const control = children as ReactElement<{
      id?: string;
      "aria-invalid"?: boolean;
      "aria-describedby"?: string;
    }>;
    return (
      <FormField
        data-field-key={errorKey ?? canonicalLabel}
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
        {error && (
          <FieldError id={`${id}-error`}>
            {translateLabels(error, t)}
          </FieldError>
        )}
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
  const t = useUiTranslations();

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const name = {
    model: t("ui.model"),
    chipset: t("ui.chipset"),
    system: t("ui.system"),
  }[field];
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
  const locale = useLocale();

  const t = useUiTranslations();
  const uiLabels_requiredMessage = translateLabels(requiredMessage, t);
  const uiLabels_labels = translateLabels(labels, t);

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
        ([key, message]) =>
          message !== uiLabels_requiredMessage || key in missing,
      );
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
  }, [draft, kind, uiLabels_requiredMessage]);
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
          setError(t("ui.failedToLoadFaeOptionsReopenTheDialogAndTryAgain"));
      });
    return () => controller.abort();
  }, [kind, t]);
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
          setError(
            t("ui.failedToLoadBusinessSuggestionsManualEntryIsStillAvailable"),
          );
      });
    return () => controller.abort();
  }, [kind, t]);
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
            ? uiLabels_requiredMessage
            : t("ui.checkThisField");
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
        setError(
          Object.keys(errors).length ? "" : t("ui.checkTheEnteredValues"),
        );
      } else {
        setError(
          errorMessage(err, t("ui.saveFailedCheckYourConnectionAndTryAgain")),
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
              {original
                ? editing
                  ? t("ui.editRecord")
                  : t("ui.recordPreview")
                : t("ui.newRecord")}{" "}
              · {uiLabels_labels[kind]}
            </DialogTitle>
            <DialogDescription className="break-words">
              {original?.display_name ??
                t("ui.saveThisRecordSoTeamMembersCanViewAndReferenceIt")}
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
                    {t(
                      "ui.thisRecordIsInRecentlyDeletedRestoreItBeforeEditing",
                    )}
                  </p>
                )}
                <FieldErrorsContext.Provider value={fieldErrors}>
                  <FieldSet disabled={saving}>
                    <FieldGroup>
                      {kind === "customers" && (
                        <>
                          <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
                            <Field label={t("ui.companyName")}>
                              {text("company_name", t("ui.companyName2"))}
                            </Field>
                            <Field label={t("ui.customerTier2")}>
                              <ManagedSelect
                                category="customer_level"
                                label={t("ui.customerTier")}
                                value={draft.level ?? ""}
                                onChange={(value) => set("level", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            <Field label={t("ui.countryRegion")}>
                              <SearchSelect
                                label={t("ui.countryRegion2")}
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
                            <Field label={t("ui.business")}>
                              <CatalogCombobox
                                label={t("ui.business")}
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
                                {t("ui.contacts")}{" "}
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
                                  {t("ui.addContact")}
                                </Button>
                              )}
                            </div>
                            {!contacts.length && (
                              <p className="text-muted-foreground rounded-lg border border-dashed p-5 text-center text-sm">
                                {t("ui.noContacts")}
                              </p>
                            )}
                            {contacts.map((contact, index) => (
                              <div
                                key={index}
                                className="bg-muted/20 space-y-4 rounded-lg border p-4"
                              >
                                <div className="flex items-center justify-between">
                                  <h4 className="text-sm font-medium">
                                    {t("ui.contacts")}
                                    {index + 1}
                                  </h4>
                                  {editing && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={t("dynamic.deleteContact", {
                                        p0: index + 1,
                                      })}
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
                                    label={t("ui.name2")}
                                    errorKey={`contact-name-${index}`}
                                  >
                                    <Input
                                      disabled={!editing || saving}
                                      aria-label={t("dynamic.contactName", {
                                        p0: index + 1,
                                      })}
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
                                  <Field label={t("ui.gender")}>
                                    <GenderSelect
                                      aria-label={t("dynamic.contactGender", {
                                        p0: index + 1,
                                      })}
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
                                  <Field label={t("ui.position")}>
                                    <Input
                                      disabled={!editing || saving}
                                      aria-label={t("dynamic.contactPosition", {
                                        p0: index + 1,
                                      })}
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
                                      {t("ui.contactMethods")}
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
                                        {t("ui.addContactMethod")}
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
                                          label={t("ui.communicationTool")}
                                          hideLabel
                                          errorKey={`contact-tool-${index}-${mi}`}
                                        >
                                          <ManagedSelect
                                            category="contact_method"
                                            label={t("ui.communicationTool2")}
                                            placeholder={t(
                                              "ui.communicationTool2",
                                            )}
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
                                        label={t("ui.value")}
                                        errorKey={`contact-value-${index}-${mi}`}
                                        hideLabel
                                      >
                                        {editing ? (
                                          <Input
                                            disabled={!editing || saving}
                                            aria-label={t(
                                              "dynamic.contactMethodValue",
                                              { p0: index + 1, p1: mi + 1 },
                                            )}
                                            placeholder={t("ui.enterAValue")}
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
                                            label={t(
                                              "dynamic.contactMethodValue",
                                              { p0: index + 1, p1: mi + 1 },
                                            )}
                                          />
                                        )}
                                      </Field>
                                      {editing && (
                                        <Button
                                          aria-label={t(
                                            "dynamic.deleteContactMethod",
                                            { p0: index + 1, p1: mi + 1 },
                                          )}
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
                                <Field label={t("ui.contactNotes")}>
                                  <Textarea
                                    disabled={!editing || saving}
                                    aria-label={t("dynamic.contactNotes", {
                                      p0: index + 1,
                                    })}
                                    maxLength={10000}
                                    autoComplete="off"
                                    placeholder={t(
                                      "ui.communicationHabitsPreferencesEtc",
                                    )}
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
                          <Field label={t("ui.companyNotes")}>
                            <Textarea
                              disabled={!editing || saving}
                              aria-label={t("ui.companyNotes")}
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
                            <Field label={t("ui.type2")}>
                              <ManagedSelect
                                category="product_type"
                                label={t("ui.type")}
                                value={draft.type ?? ""}
                                onChange={(value) => set("type", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            {(["model", "chipset", "system"] as const).map(
                              (f) => (
                                <Field
                                  key={f}
                                  label={`${{ model: t("ui.model"), chipset: t("ui.chipset"), system: t("ui.system") }[f]} *`}
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
                              <Field label={t("ui.firmwareDownloadUrl")}>
                                <Input
                                  disabled={!editing || saving}
                                  aria-label={t("ui.firmwareDownloadUrl")}
                                  type="url"
                                  maxLength={2000}
                                  placeholder="https://…"
                                  value={draft.repository_url}
                                  onChange={(e) =>
                                    set("repository_url", e.target.value)
                                  }
                                />
                              </Field>
                              <Field label={t("ui.projectFingerprint")}>
                                <Textarea
                                  disabled={!editing || saving}
                                  aria-label={t("ui.projectFingerprint")}
                                  maxLength={10000}
                                  placeholder={t("ui.enterAProjectFingerprint")}
                                  value={draft.fingerprint}
                                  onChange={(e) =>
                                    set("fingerprint", e.target.value)
                                  }
                                />
                              </Field>
                            </>
                          )}
                          <Field label={t("ui.notes2")}>
                            <Textarea
                              disabled={!editing || saving}
                              aria-label={t("ui.productNotes")}
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
                            <Field label={t("ui.projectNumber2")}>
                              {text("number", t("ui.projectNumber"), true, 100)}
                            </Field>
                            <Field label={t("ui.projectManagerPm")}>
                              <ManagedSelect
                                category="project_pm"
                                label={t("ui.projectManager")}
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
                                  value={draft.fae_name || t("ui.unspecified")}
                                  readOnly
                                />
                              )}
                            </Field>
                            <Field label={t("ui.startDate2")}>
                              <StartDatePicker
                                value={draft.start_date ?? ""}
                                onChange={(value) => set("start_date", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                            <Field label={t("ui.projectStage2")}>
                              <ManagedSelect
                                category="project_stage"
                                label={t("ui.projectStage")}
                                value={draft.stage ?? ""}
                                onChange={(value) => set("stage", value)}
                                disabled={!editing || saving}
                              />
                            </Field>
                          </FieldGroup>
                          <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
                            <Field label={t("ui.customer2")}>
                              <SearchSelect
                                label={t("ui.customer")}
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
                            <Field label={t("ui.product2")}>
                              <SearchSelect
                                label={t("ui.product")}
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
                    <Field label={t("ui.firmwareDownloadUrl")}>
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
                          {t("ui.notProvided")}
                        </span>
                      )}
                    </Field>
                    <Field label={t("ui.projectFingerprint")}>
                      <CopyField
                        value={draft.fingerprint ?? ""}
                        label={t("ui.projectFingerprint")}
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
                      {t("ui.editRecord")}
                      <ChevronDown className="transition-transform group-data-open:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <dl className="text-muted-foreground grid grid-cols-2 gap-3 p-4 pt-2 text-xs">
                        <div>
                          <dt>{t("ui.createdBy")}</dt>
                          <dd className="text-foreground mt-1">
                            {original.created_by_name}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("ui.created")}</dt>
                          <dd className="mt-1">
                            {new Date(original.created_at).toLocaleString(
                              locale,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("ui.updatedBy")}</dt>
                          <dd className="text-foreground mt-1">
                            {original.updated_by_name}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("ui.updated")}</dt>
                          <dd className="mt-1">
                            {new Date(original.updated_at).toLocaleString(
                              locale,
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
                  {t("ui.delete")}
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
                    {original ? t("ui.cancelEditing") : t("ui.reset")}
                  </Button>
                  <Button key="save" type="submit" disabled={saving}>
                    {saving && (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    )}
                    {t("ui.save")}
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
                      {t("ui.edit")}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
        <ConfirmDialog
          open={confirmClose}
          title={t("ui.discardUnsavedChanges")}
          description={t(
            "ui.yourChangesHaveNotBeenSavedDiscardingWillLoseThem",
          )}
          confirmLabel={t("ui.discardChanges")}
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
