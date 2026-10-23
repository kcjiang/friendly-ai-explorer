import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import zh from "../../messages/zh-CN.json";
import labelKeys from "./label-keys.json";
import { getBrowserUiLocale } from "./browser";
import type { UiTranslator } from "./client";

export function systemMessage(
  value: unknown,
  translator?: UiTranslator,
): string {
  const t: UiTranslator =
    translator ??
    (createTranslator({
      locale: getBrowserUiLocale(),
      messages: getBrowserUiLocale() === "zh-CN" ? zh : en,
    }) as UiTranslator);
  let data: unknown = value;
  if (typeof value === "string" && value.includes("@i18n:")) {
    try {
      data = JSON.parse(value.slice(value.indexOf("@i18n:") + 6));
    } catch {
      return t("ui.operationFailed");
    }
  }
  if (
    data &&
    typeof data === "object" &&
    "code" in data &&
    typeof data.code === "string"
  ) {
    const params =
      "params" in data && data.params && typeof data.params === "object"
        ? (data.params as Record<string, string | number>)
        : {};
    // Unknown codes never expose resource keys to end users.
    const section = data.code.split(".");
    if (
      section.length === 2 &&
      section[0] === "errors" &&
      section[1] in en.errors
    )
      return t(data.code, params);
    return t("ui.operationFailed");
  }
  if (typeof value !== "string") return t("ui.operationFailed");
  const key = labelKeys[value as keyof typeof labelKeys];
  return key ? t(key) : value;
}
