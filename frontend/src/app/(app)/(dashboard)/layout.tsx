"use client";

import { useUiTranslations } from "@/i18n/client";
import { TopNav } from "@/components/nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();
  return (
    <>
      <TopNav title={t("ui.extraDashboard")} />
      <main>{children}</main>
    </>
  );
}
