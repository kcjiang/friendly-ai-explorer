import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { browserLocale, isLocale, localeCookie } from "./locale";

export default getRequestConfig(async () => {
  const saved = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(saved)
    ? saved
    : browserLocale((await headers()).get("accept-language") ?? "");
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // A stable reference prevents server/client relative-time mismatches.
    now: new Date(),
    timeZone: "UTC",
  };
});
