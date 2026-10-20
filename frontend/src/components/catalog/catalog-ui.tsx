"use client";

import { zhCN } from "catalog-day-picker/locale";
import { format, isValid, parseISO } from "date-fns";
import { CalendarDays, Trash2 } from "lucide-react";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/base/alert-dialog";
import { Button } from "@/components/ui/base/button";
import { Calendar } from "@/components/ui/base/calendar";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/base/combobox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/base/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/base/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/base/popover";

export async function copyCatalogText(text: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Clipboard permission timed out")),
          1500,
        );
      }),
    ]);
    return;
  } catch {
    // Embedded browsers may leave the permission promise pending. Keep the
    // fallback inside the active dialog so its focus trap permits selection.
    const previous = document.activeElement as HTMLElement | null;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    (previous?.closest('[role="dialog"]') ?? document.body).append(textarea);
    try {
      textarea.focus();
      textarea.select();
      if (!document.execCommand("copy"))
        throw new Error("Clipboard permission denied");
    } finally {
      textarea.remove();
      previous?.focus();
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function Identification({
  children,
  name,
}: {
  children: ReactElement;
  name: string;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger render={children} />
      <HoverCardContent align="start">
        <p className="font-medium">识别名称</p>
        <p className="text-muted-foreground mt-1 break-words">{name}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  destructive,
  busy,
  error,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next, details) => {
        if (busy) details.cancel();
        else if (!next) onCancel();
      }}
    >
      <AlertDialogContent
        size={destructive ? "sm" : "default"}
        initialFocus={cancelRef}
        className="z-[70]"
      >
        <AlertDialogHeader>
          {destructive && (
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20">
              <Trash2 />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy}>
            {destructive ? "取消" : "继续编辑"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Choice = { value: string; label: string };
export function CatalogCombobox({
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  label,
  value,
  options,
  onChange,
  disabled,
  multiple,
  popup,
  creatable,
  loading,
  error,
  onQueryChange,
  clearable,
  optionAction,
  footer,
  serverSearch,
  searchable = true,
  required,
  placeholder,
  open,
  onOpenChange,
  onOpenChangeComplete,
}: {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  label: string;
  value: string[];
  options: Choice[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  multiple?: boolean;
  popup?: boolean;
  creatable?: boolean;
  loading?: boolean;
  error?: boolean;
  onQueryChange?: (query: string) => void;
  clearable?: boolean;
  optionAction?: (option: Choice) => ReactNode;
  footer?: ReactNode;
  serverSearch?: boolean;
  searchable?: boolean;
  required?: boolean;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLDivElement>(null);
  // The collection must never receive duplicate or empty identities.
  const uniqueOptions = Array.from(
    new Map(options.filter((o) => o.value).map((o) => [o.value, o])).values(),
  );
  const selected = Array.from(new Set(value.filter(Boolean))).map(
    (v) => uniqueOptions.find((o) => o.value === v) ?? { value: v, label: v },
  );
  const base = [
    ...uniqueOptions,
    ...selected.filter((o) => !uniqueOptions.some((x) => x.value === o.value)),
  ];
  const create =
    (multiple || creatable) &&
    query.trim() &&
    !base.some((o) => o.value === query.trim())
      ? { value: query.trim(), label: `添加「${query.trim()}」` }
      : null;
  const choices = [...base, ...(create ? [create] : [])];
  const content = (
    <>
      {loading && (
        <p role="status" className="text-muted-foreground px-2 py-1 text-xs">
          加载中…
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive px-2 py-1 text-xs">
          选项加载失败，请重新打开重试。
        </p>
      )}
      <ComboboxEmpty>没有匹配选项</ComboboxEmpty>
      <ComboboxList>
        {(item: Choice) =>
          optionAction ? (
            <div key={item.value} className="flex items-center gap-1">
              <ComboboxItem value={item} className="min-w-0 flex-1">
                {item.label}
              </ComboboxItem>
              {optionAction(item)}
            </div>
          ) : (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )
        }
      </ComboboxList>
      {footer}
    </>
  );
  const shared = {
    open,
    onOpenChangeComplete,
    items: choices,
    disabled,
    required,
    autoHighlight: true,
    isItemEqualToValue: (a: Choice, b: Choice) => a.value === b.value,
    filter:
      serverSearch || !searchable
        ? null
        : (item: Choice, search: string) =>
            `${item.label} ${item.value}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
    onInputValueChange: (next: string, details: { reason: string }) => {
      setQuery(next);
      onQueryChange?.(next);
      if (creatable && !multiple && details.reason === "input-change")
        onChange(next ? [next] : []);
    },
    onOpenChange: (open: boolean) => {
      onOpenChange?.(open);
      if (open) onQueryChange?.(query);
    },
  };
  if (multiple)
    return (
      <Combobox
        {...shared}
        multiple
        value={selected}
        inputValue={query}
        onValueChange={(next) => {
          onChange(next.map((o) => o.value));
          setQuery("");
        }}
      >
        <ComboboxChips ref={anchor} className="w-full">
          <ComboboxValue>
            {(values: Choice[]) =>
              values.map((item) => (
                <ComboboxChip
                  key={item.value}
                  aria-label={item.label}
                  showRemove={!disabled}
                >
                  {item.label}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          {!disabled && (
            <ComboboxChipsInput
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-label={label}
              placeholder={value.length ? "" : "选择或输入姓名"}
              maxLength={100}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  create
                ) {
                  event.preventDefault();
                  onChange([...value, create.value]);
                  setQuery("");
                  onQueryChange?.("");
                }
              }}
            />
          )}
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>{content}</ComboboxContent>
      </Combobox>
    );
  return (
    <Combobox
      {...shared}
      value={selected[0] ?? null}
      onValueChange={(next) => {
        onChange(next ? [next.value] : []);
        setQuery("");
      }}
    >
      {popup ? (
        <>
          <ComboboxTrigger
            id={id}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            render={
              <Button
                variant="outline"
                className="w-full justify-between font-normal"
              />
            }
            aria-label={label}
            aria-required={required}
          >
            <ComboboxValue placeholder={placeholder ?? `选择${label}`} />
          </ComboboxTrigger>
          <ComboboxContent>
            {searchable && (
              <ComboboxInput
                aria-label={`搜索${label}`}
                placeholder={`搜索${label}…`}
                showTrigger={false}
              />
            )}
            {content}
          </ComboboxContent>
        </>
      ) : (
        <>
          <ComboboxInput
            id={id}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-label={label}
            showClear={clearable}
            placeholder={placeholder ?? `选择${label}`}
            className="w-full"
            disabled={disabled}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                create
              ) {
                event.preventDefault();
                onChange([create.value]);
                setQuery("");
              }
            }}
          />
          <ComboboxContent>{content}</ComboboxContent>
        </>
      )}
    </Combobox>
  );
}

export function StartDatePicker({
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parseISO(value) : undefined;
  const date = parsed && isValid(parsed) ? parsed : undefined;
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        aria-describedby={describedBy}
        aria-label="立项时间"
        placeholder="YYYY-MM-DD"
        required
        disabled={disabled}
        value={value}
        aria-invalid={invalid || Boolean(value && !date)}
        pattern="[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <InputGroupButton
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
              />
            }
            aria-label="打开立项日历"
          >
            <CalendarDays />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            alignOffset={-8}
            sideOffset={10}
            className="w-auto overflow-hidden p-0"
          >
            <Calendar
              mode="single"
              locale={zhCN}
              selected={date}
              defaultMonth={date}
              autoFocus
              onSelect={(next) => {
                if (next) {
                  onChange(format(next, "yyyy-MM-dd"));
                  setOpen(false);
                }
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}
