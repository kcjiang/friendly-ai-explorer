"use client";

import { TopNav } from "@/components/nav";
import { useUiTranslations } from "@/i18n/client";

export default function SerialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();

  return (
    <div className="flex h-screen flex-col">
      <TopNav title={t("ui.serialDebuggingWebSerial")} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
