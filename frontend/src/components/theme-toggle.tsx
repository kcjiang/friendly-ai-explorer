"use client";

import { Bug, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { Button } from "@/components/ui/base/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/base/dropdown-menu";
import { VersionBadge } from "@/components/version-badge";
import { useHydration } from "@/hooks/use-hydration";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const hydrated = useHydration();

  return (
    <div className="flex shrink-0 items-center gap-3">
      <VersionBadge />
      <Button
        variant="outline"
        size="icon"
        nativeButton={false}
        render={
          <a
            href="https://github.com/kcjiang/friendly-ai-explorer/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="提报 Bug（新标签页打开）"
            title="提报 Bug"
          />
        }
      >
        <Bug className="h-[1.2rem] w-[1.2rem]" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" className="relative" />}
        >
          <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          {hydrated && theme === "system" && <AutoThemeBadge />}
          <span className="sr-only">Toggle theme</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            Light
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            Dark
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            System
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AutoThemeBadge() {
  return (
    <span className="bg-secondary text-secondary-foreground ring-background animate-in zoom-in-50 absolute -top-2 -right-2 flex h-4 items-center rounded-full px-1.5 text-[0.6rem] ring-2 duration-300">
      auto
    </span>
  );
}
