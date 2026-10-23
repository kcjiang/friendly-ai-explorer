"use client";
import { useUiTranslations } from "@/i18n/client";

import { ArrowUpDown } from "lucide-react";
import { type ReactNode } from "react";
import Container from "@/components/container";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { NativeSelect } from "./native-select";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export function PageToolbar({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <Container
      data-page-toolbar
      className={cn(
        "flex h-16 shrink-0 items-center gap-3 overflow-x-auto border-b border-border [&>*]:shrink-0",
        compact &&
          "h-auto min-h-[54px] flex-wrap gap-2 overflow-visible bg-muted/10 py-2.5 [&_[role=tab]]:h-7 [&_[role=tab]]:py-1 [&_[role=tablist]]:h-8 [&_[role=tablist]]:gap-0 [&_[role=tablist]]:p-0.5 [&_button]:h-8 [&_button]:rounded-lg [&_button]:px-2.5 [&_button]:py-1.5 [&_button]:text-xs [&_button_svg]:!size-3 [&_input]:h-8 [&_input]:rounded-lg [&_input]:text-xs [&_select]:h-8 [&_select]:rounded-lg [&_select]:px-2.5 [&_select]:text-xs",
      )}
    >
      {children}
    </Container>
  );
}

export function SortMenu({
  value,
  direction,
  options,
  onChange,
  onDirectionChange,
}: {
  value: string;
  direction: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
  onDirectionChange: (value: string) => void;
}) {
  const t = useUiTranslations();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("ui.sortOptions")}
          title={t("dynamic.sort", {
            p0: options[value],
            p1: direction === "desc" ? t("ui.descending") : t("ui.ascending"),
          })}
        >
          <ArrowUpDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <p className="text-sm font-medium">{t("ui.sort")}</p>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>{t("ui.sortField")}</span>
          <NativeSelect
            aria-label={t("ui.sortField")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {Object.entries(options).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>{t("ui.sortDirection")}</span>
          <NativeSelect
            aria-label={t("ui.sortDirection")}
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value)}
          >
            <option value="desc">{t("ui.descending")}</option>
            <option value="asc">{t("ui.ascending")}</option>
          </NativeSelect>
        </label>
      </PopoverContent>
    </Popover>
  );
}
