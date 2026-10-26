"use client";

import { TopNav } from "@/components/nav";
import { useUiTranslations } from "@/i18n/client";

export default function TicketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();

  return (
    <>
      <TopNav title={t("ui.ticketBoard")} />
      {/* 不使用 Container，让看板占满全宽 */}
      <main>{children}</main>
    </>
  );
}
