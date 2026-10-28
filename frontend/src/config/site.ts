import {
  BookOpen,
  Database,
  FolderOpen,
  Gauge,
  type LucideIcon,
  PanelsTopLeft,
  Settings,
  SlidersHorizontal,
  SquareKanban,
  Terminal,
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
    name: "Workbench",
    href: "/workbench",
  },
  {
    icon: SquareKanban,
    name: "Ticket",
    href: "/ticket",
  },
  {
    icon: Database,
    name: "Data management",
    href: "/catalog",
  },
  {
    icon: BookOpen,
    name: "Knowledge",
    href: "/knowledge",
  },
  { icon: FolderOpen, name: "Storage", href: "/storage" },
  {
    icon: Terminal,
    name: "Device Terminal",
    href: "/terminal",
  },
  {
    icon: SlidersHorizontal,
    name: "Device Console",
    href: "/device-console",
  },
  {
    icon: Settings,
    name: "Admin",
    href: "/admin",
    accessible: ["developer"],
  },
];
