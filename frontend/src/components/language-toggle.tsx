"use client";
import { useUiTranslations } from "@/i18n/client";

import { Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/base/dropdown-menu";
import { localeCookie, type Locale } from "@/i18n/locale";

export function LanguageToggle() {
  const t = useUiTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function select(next: Locale) {
    if (next === locale) return;
    // No Expires or Max-Age: the selection belongs to this browser session.
    document.cookie = `${localeCookie}=${next}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    startTransition(() => router.refresh());
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            disabled={pending}
            aria-label={
              locale === "zh-CN" ? "选择语言" : t("ui.extraSelectlanguage")
            }
          />
        }
      >
        <Languages className="h-[1.2rem] w-[1.2rem]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          lang="en"
          onClick={() => select("en")}
          aria-current={locale === "en" ? "true" : undefined}
        >
          English {locale === "en" && "✓"}
        </DropdownMenuItem>
        <DropdownMenuItem
          lang="zh-CN"
          onClick={() => select("zh-CN")}
          aria-current={locale === "zh-CN" ? "true" : undefined}
        >
          简体中文 {locale === "zh-CN" && "✓"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
