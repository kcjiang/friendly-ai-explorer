"use client";

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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="排序选项"
          title={`排序：${options[value]} · ${direction === "desc" ? "降序" : "升序"}`}
        >
          <ArrowUpDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <p className="text-sm font-medium">排序</p>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>排序字段</span>
          <NativeSelect
            aria-label="排序字段"
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
          <span>排序方向</span>
          <NativeSelect
            aria-label="排序方向"
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value)}
          >
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </NativeSelect>
        </label>
      </PopoverContent>
    </Popover>
  );
}
