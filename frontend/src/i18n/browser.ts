import { browserLocale, isLocale, localeCookie, type Locale } from "./locale";

export function getBrowserUiLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const saved = document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(localeCookie + "="))
    ?.slice(localeCookie.length + 1);
  if (isLocale(saved)) return saved;
  const rendered = document.documentElement.lang;
  return isLocale(rendered) ? rendered : browserLocale(navigator.language);
}
