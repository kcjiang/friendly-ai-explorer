"use client";

import { AdminChangesProvider } from "@/components/admin/unsaved-changes";
import { TopNav } from "@/components/nav";
import { useUiTranslations } from "@/i18n/client";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();

  return (
    <AdminChangesProvider>
      <TopNav title={t("ui.administration")} />
      <main>{children}</main>
    </AdminChangesProvider>
  );
}
