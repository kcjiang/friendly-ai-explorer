"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useFeedback } from "@/components/ui/feedback-provider";

const Context = createContext<{
  register: (key: string, dirty: boolean) => void;
  canLeave: () => Promise<boolean>;
} | null>(null);

export function AdminChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<string>());
  const prompting = useRef(false);
  const { confirm } = useFeedback();
  const chinese = useLocale() === "zh-CN";
  const router = useRouter();
  const register = useCallback((key: string, value: boolean) => {
    if (value) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);
  const canLeave = useCallback(async () => {
    if (!dirty.current.size) return true;
    if (prompting.current) return false;
    prompting.current = true;
    try {
      return await confirm(
        chinese
          ? "有未保存的修改。离开将放弃这些修改，是否继续？"
          : "You have unsaved changes. Leave and discard them?",
      );
    } finally {
      prompting.current = false;
    }
  }, [confirm, chinese]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        !dirty.current.size ||
        event.defaultPrevented ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      )
        return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.href === location.href) return;
      event.preventDefault();
      event.stopPropagation();
      void canLeave().then((allowed) => {
        if (allowed) router.push(url.pathname + url.search + url.hash);
      });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [canLeave, router]);
  return (
    <Context.Provider value={{ register, canLeave }}>
      {children}
    </Context.Provider>
  );
}

export function useAdminChanges(key: string, dirty: boolean) {
  const context = useContext(Context);
  const register = context?.register;
  useEffect(() => {
    register?.(key, dirty);
    return () => register?.(key, false);
  }, [register, key, dirty]);
}

export function useAdminLeave() {
  const context = useContext(Context);
  return context?.canLeave ?? (async () => true);
}
