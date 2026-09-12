// frontend/src/config/site.tsx

import { Gauge, type LucideIcon, SquareKanban, MessagesSquare, BookOpen, Usb, Cable, Settings } from "lucide-react";

export type SiteConfig = typeof siteConfig;
export type Role = "developer" | "leader" | "engineer" | "guest";
export type Navigation = {
  icon:   LucideIcon;
  name:   string;
  href:   string;
  accessible?: Role[];   // 可访问角色，空置为全员访问
};

export const siteConfig = {
  title: "SDMC - Friendly AI Explorer",
  description: "FAE tool integration platform",
};

export const navigations: Navigation[] = [
  {
    icon: Gauge,
    name: "Dashboard",
    href: "/",
  },
  {
    icon: SquareKanban,
    name: "Ticket",
    href: "/ticket",
  },
  {
    icon: BookOpen,
    name: "Knowledge",
    href: "/knowledge",
  },
  {
    icon: MessagesSquare,
    name: "Email Analysis",
    href: "/email",
  },
  {
    icon: Usb,
    name: "ADB Connection",
    href: "/adb",
  },
  {
    icon: Cable,
    name: "Serial Port",
    href: "/serial",
  },
  {
    icon: Settings,
    name: "Admin",
    href: "/admin",
    accessible: ["developer", "leader"],
  },
];
