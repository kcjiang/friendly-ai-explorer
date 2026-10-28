"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/base/resizable";
import { Skeleton } from "@/components/ui/base/skeleton";
import styles from "./storage-workspace.module.css";

const WIDTH_KEY = "fae-storage-navigation-width";

export default function StorageWorkspace({
  navigation,
  mobileNavigation,
  children,
  resizeLabel,
}: {
  navigation: ReactNode;
  mobileNavigation: ReactNode;
  children: ReactNode;
  resizeLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    wide: boolean;
    height: number;
  } | null>(null);
  const width = useRef(192);
  useLayoutEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= 88 && saved <= 240)
        width.current = saved;
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
    const element = host.current;
    if (!element) return;
    const update = () => {
      if (!element.clientWidth) return;
      const page = element.closest("[data-storage-page]");
      const top =
        element.getBoundingClientRect().top -
        (page?.getBoundingClientRect().top ?? 0);
      const height = Math.max(420, window.innerHeight - top - 24);
      const wide = element.clientWidth >= 480;
      setLayout((old) =>
        old?.height === height && old.wide === wide ? old : { height, wide },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const toolbar = element
      .closest("[data-storage-page]")
      ?.querySelector("[data-page-toolbar]");
    if (toolbar) observer.observe(toolbar);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div ref={host} className={styles.host}>
      {!layout ? (
        <div
          className={styles.placeholder}
          role="status"
          aria-label={resizeLabel}
          aria-busy="true"
        >
          <div className={`${styles.navigation} space-y-3 pt-4 pr-4`}>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="space-y-4 pt-4 pl-5">
            <Skeleton className="h-8 w-40" />
            <div className="space-y-3 rounded-lg border p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
        </div>
      ) : layout.wide ? (
        <ResizablePanelGroup
          orientation="horizontal"
          style={{ height: layout.height }}
        >
          <ResizablePanel
            id="storage-navigation"
            defaultSize={width.current}
            minSize={88}
            maxSize={240}
            onResize={(size, _id, previous) => {
              if (!previous) return;
              const nextWidth = Math.min(240, Math.max(88, size.inPixels));
              width.current = nextWidth;
              try {
                localStorage.setItem(WIDTH_KEY, String(nextWidth));
              } catch {
                /* Resizing works without persistence. */
              }
            }}
          >
            <aside
              className={`${styles.navigationPanel} flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto pt-4 pr-4`}
            >
              {navigation}
            </aside>
          </ResizablePanel>
          <ResizableHandle withHandle aria-label={resizeLabel} />
          <ResizablePanel id="storage-files" minSize={360}>
            <main className="h-full min-w-0 overflow-auto pt-4 pl-5">
              {children}
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-w-0 space-y-4 pt-4">
          {mobileNavigation}
          <main className="min-w-0">{children}</main>
        </div>
      )}
    </div>
  );
}
