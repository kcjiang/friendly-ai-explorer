export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];
export const localeCookie = "FAE_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return locales.includes(value as Locale);
}

/** Traditional Chinese is deliberately not mapped to Simplified Chinese. */
export function browserLocale(acceptLanguage: string): Locale {
  const first =
    acceptLanguage
      .split(",")
      .map((part, index) => {
        const [tag, ...parameters] = part.trim().split(";");
        const quality = parameters.find((p) => p.trim().startsWith("q="));
        return {
          tag: tag.toLowerCase(),
          q: quality ? Number(quality.trim().slice(2)) : 1,
          index,
        };
      })
      .filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1)
      .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.tag ?? "";
  if (first.includes("hant") || /(?:^|[-_])(tw|hk|mo)(?:$|[-_])/.test(first))
    return "en";
  if (/^zh-(?:cn|sg)(?:-|$)/.test(first) || /^zh-hans(?:-|$)/.test(first))
    return "zh-CN";
  return "en";
}
