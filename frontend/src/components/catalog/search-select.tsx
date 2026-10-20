"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { type CatalogPage, type Option } from "@/types/catalog";
import { CatalogCombobox } from "./catalog-ui";

export function SearchSelect({
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  label,
  value,
  selectedLabel,
  url,
  kind,
  disabled,
  onChange,
}: {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  label: string;
  value: string;
  selectedLabel: string;
  url: string;
  kind?: "catalog";
  disabled?: boolean;
  onChange: (option: Option) => void;
}) {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const remoteQuery = kind === "catalog" ? query : "";
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      api
        .get(url, {
          params:
            kind === "catalog" ? { q: remoteQuery, page_size: 50 } : undefined,
          signal: controller.signal,
        })
        .then(({ data }) => {
          if (!controller.signal.aborted)
            setOptions(
              kind
                ? (data as CatalogPage).items.map((r) => ({
                    value: r.id,
                    label: r.display_name,
                  }))
                : data,
            );
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [remoteQuery, url, kind, disabled, attempt]);
  const choices =
    value && !options.some((o) => o.value === value)
      ? [{ value, label: selectedLabel }, ...options]
      : options;
  return (
    <CatalogCombobox
      id={id}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      label={label}
      value={value ? [value] : []}
      options={choices}
      popup
      // Catalog endpoints filter remotely; countries return the full directory.
      serverSearch={kind === "catalog"}
      disabled={disabled}
      loading={loading}
      error={error}
      onQueryChange={setQuery}
      onOpenChange={(open) => {
        if (open) setAttempt((a) => a + 1);
      }}
      onChange={(next) => {
        const option = choices.find((o) => o.value === next[0]);
        if (option) onChange(option);
      }}
    />
  );
}
