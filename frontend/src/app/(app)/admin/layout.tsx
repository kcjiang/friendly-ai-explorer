"use client";

import { useUiTranslations } from "@/i18n/client";
import { TopNav } from "@/components/nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();

  return (
    <>
      <TopNav title={t("ui.administration")} />
      <main>{children}</main>
    </>
  );
}
