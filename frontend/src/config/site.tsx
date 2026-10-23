// frontend/src/config/site.tsx
import {
  BookOpen,
  Cable,
  Database,
  Gauge,
  type LucideIcon,
  PanelsTopLeft,
  Settings,
  SquareKanban,
  Usb,
} from "lucide-react";

export type SiteConfig = typeof siteConfig;
export type Role = "developer" | "leader" | "engineer" | "guest";
export type Navigation = {
  icon: LucideIcon;
  name: string;
  href: string;
  accessible?: Role[]; // 可访问角色，空置为全员访问
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
    icon: PanelsTopLeft,
    name: "工作台",
    href: "/workbench",
  },
  {
    icon: SquareKanban,
    name: "Ticket",
    href: "/ticket",
  },
  {
    icon: Database,
    name: "数据维护",
    href: "/catalog",
  },
  {
    icon: BookOpen,
    name: "Knowledge",
    href: "/knowledge",
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
