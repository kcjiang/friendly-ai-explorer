"use client";

import { useTranslations } from "next-intl";
import labelKeys from "./label-keys.json";

const identifierKeys = new Set([
  "id",
  "key",
  "value",
  "href",
  "icon",
  "accessible",
  "platform",
  "thinking_mode",
  "structured_output",
]);

export type UiTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function useUiTranslations(): UiTranslator {
  return useTranslations();
}

/** Only apply to application-owned static label definitions, never business data. */
export function translateLabels<T>(value: T, t: UiTranslator): T {
  if (typeof value === "string") {
    const key = labelKeys[value as keyof typeof labelKeys];
    return (key ? t(key) : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => translateLabels(v, t)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        identifierKeys.has(key) ? v : translateLabels(v, t),
      ]),
    ) as T;
  }
  return value;
}
