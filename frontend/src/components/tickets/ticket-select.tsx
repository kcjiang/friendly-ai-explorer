"use client";
import { useUiTranslations } from "@/i18n/client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base/select";

export function TicketSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  disabled,
  required,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
}) {
  const t = useUiTranslations();
  return (
    <Select
      value={value || null}
      onValueChange={(next) => onValueChange(next ?? "")}
      disabled={disabled}
      required={required}
      items={options}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={className ?? "w-full"}
      >
        <SelectValue
          placeholder={t("dynamic.selectmessage65", { p0: label })}
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
