"use client";
import { useUiTranslations } from "@/i18n/client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/base/resizable";

export function MailSplitLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const t = useUiTranslations();

  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="min-h-0 flex-1 overflow-hidden">
      {width >= 700 ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0">
          <ResizablePanel
            id="mail-folders"
            defaultSize={220}
            minSize={160}
            maxSize={Math.min(320, width * 0.4)}
            className="[&>aside]:h-full"
          >
            {sidebar}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            aria-label={t("ui.resizeMailSidebar")}
            className="before:bg-border w-3 bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px"
          />
          <ResizablePanel
            id="mail-content"
            minSize={360}
            maxSize={width - 160}
            className="[&>main]:h-full"
          >
            {children}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
          {sidebar}
          {children}
        </div>
      )}
    </div>
  );
}
