"use client";

import { useUiTranslations } from "@/i18n/client";
import { TopNav } from "@/components/nav";

export default function AdbLayout({ children }: { children: React.ReactNode }) {
  const t = useUiTranslations();

  return (
    <div className="flex flex-col h-screen">
      <TopNav title={t("ui.adbDebuggingWebusb")} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
