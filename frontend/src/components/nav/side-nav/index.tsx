"use client";

import { ArrowLeftToLine, ArrowRightToLine } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import AIBrand from "./components/footer-brand";
import Navigation from "./components/navigation";
import User from "./components/user";

export default function SideNav() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className={cn(
          "text-primary-foreground tablet:hidden fixed top-12 left-0 z-50 rounded-r-md bg-slate-200 px-2 py-1.5 shadow-md hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-44" : "translate-x-0",
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ArrowLeftToLine size={16} />
        ) : (
          <ArrowRightToLine size={16} />
        )}
      </button>
      <aside
        className={cn(
          "border-border tablet:sticky tablet:translate-x-0 fixed top-0 bottom-0 left-0 z-40 flex h-[100dvh] w-44 shrink-0 flex-col border-r bg-slate-100 dark:bg-slate-900",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <User />
        <Navigation />
        <AIBrand />
      </aside>
    </>
  );
}
