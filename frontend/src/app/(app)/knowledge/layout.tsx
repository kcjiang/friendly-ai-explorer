"use client";

import { TopNav } from "@/components/nav";
import { useUiTranslations } from "@/i18n/client";

export default function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useUiTranslations();

  return (
    <div className="flex h-screen flex-col">
      <TopNav title={t("ui.knowledgeBase")} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
