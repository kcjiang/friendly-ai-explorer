"use client";

import { useUiTranslations } from "@/i18n/client";
import { TopNav } from "@/components/nav";

export default function SerialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();

  return (
    <div className="flex flex-col h-screen">
      <TopNav title={t("ui.serialDebuggingWebSerial")} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
