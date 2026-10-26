"use client";

import { TopNav } from "@/components/nav";
import { useUiTranslations } from "@/i18n/client";

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
