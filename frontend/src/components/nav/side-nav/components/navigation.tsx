"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { navigations, type Role } from "@/config/site";
import { cn } from "@/lib/utils";

export default function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "guest";

  // 过滤可见导航链接
  const visibleItems = navigations.filter((nav) => {
    if (!nav.accessible || nav.accessible.length === 0) {
      return true; // 全员可访问
    }
    return nav.accessible.includes(role as Role);
  });

  return (
    <nav className="flex flex-grow flex-col gap-y-1 p-2">
      {visibleItems.map((navigation) => {
        const Icon = navigation.icon;
        return (
          <Link
            key={navigation.name}
            href={navigation.href}
            className={cn(
              "flex items-center rounded-md px-2 py-1.5 hover:bg-slate-200 dark:hover:bg-slate-800",
              pathname === navigation.href
                ? "bg-slate-200 dark:bg-slate-800"
                : "bg-transparent",
            )}
          >
            <Icon
              size={16}
              className="mr-2 text-slate-800 dark:text-slate-200"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {navigation.name}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
