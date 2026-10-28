"use client";

import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import AppLogs from "@/components/admin/app-logs";
import { TopNav } from "@/components/nav";

export default function SystemLogsPage() {
  const { data: session } = useSession();
  const locale = useLocale();
  if (session?.user?.role !== "developer") return null;
  return (
    <div>
      <TopNav title={locale === "zh-CN" ? "系统运行日志" : "System logs"} />
      <div className="p-4">
        <AppLogs />
      </div>
    </div>
  );
}
