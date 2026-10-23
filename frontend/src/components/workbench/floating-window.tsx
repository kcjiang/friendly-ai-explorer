"use client";
import { useUiTranslations, translateLabels } from "@/i18n/client";

import { Maximize2, Minimize2, X } from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Dialog as Primitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/base/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/base/dialog";
import {
  type ResizeEdge,
  type WindowRect,
  centerWindow,
  fitWindow,
  resizeWindow,
} from "@/lib/floating-window";
import { cn } from "@/lib/utils";

const edges: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const handles: Record<ResizeEdge, string> = {
  n: "-top-1 left-2 right-2 h-2 cursor-ns-resize",
  s: "-bottom-1 left-2 right-2 h-2 cursor-ns-resize",
  e: "-right-1 top-2 bottom-2 w-2 cursor-ew-resize",
  w: "-left-1 top-2 bottom-2 w-2 cursor-ew-resize",
  ne: "-top-1 -right-1 size-4 cursor-nesw-resize",
  nw: "-top-1 -left-1 size-4 cursor-nwse-resize",
  se: "-bottom-1 -right-1 size-4 cursor-nwse-resize",
  sw: "-bottom-1 -left-1 size-4 cursor-nesw-resize",
};
const labels = {
  n: "Top",
  s: "Bottom",
  e: "Right",
  w: "Left",
  ne: "Top right",
  nw: "Top left",
  se: "Bottom right",
  sw: "Bottom left",
};
function viewport() {
  return {
    width: window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

export function FloatingWindow({
  open,
  onClose,
  children,
  title: suppliedTitle,
  initialSize = { width: 720, height: 420 },
  containScroll = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  initialSize?: { width: number; height: number };
  containScroll?: boolean;
}) {
  const t = useUiTranslations();
  const title = suppliedTitle ?? t("ui.liveAiOutput");
  const uiLabels_labels = translateLabels(labels, t);

  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = popup.current;
    if (!open || !containScroll || !element) return;
    const stopChain = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      let target = event.target instanceof Element ? event.target : null;
      while (target && element.contains(target)) {
        const style = getComputedStyle(target);
        const vertical =
          /auto|scroll/.test(style.overflowY) &&
          target.scrollHeight > target.clientHeight &&
          (event.deltaY < 0
            ? target.scrollTop > 0
            : event.deltaY > 0 &&
              target.scrollTop + target.clientHeight < target.scrollHeight - 1);
        const horizontal =
          /auto|scroll/.test(style.overflowX) &&
          target.scrollWidth > target.clientWidth &&
          (event.deltaX < 0
            ? target.scrollLeft > 0
            : event.deltaX > 0 &&
              target.scrollLeft + target.clientWidth < target.scrollWidth - 1);
        if (vertical || horizontal) return;
        if (target === element) break;
        target = target.parentElement;
      }
      event.preventDefault();
    };
    element.addEventListener("wheel", stopChain, { passive: false });
    return () => element.removeEventListener("wheel", stopChain);
  }, [open, containScroll]);
  const [rect, setRect] = useState<WindowRect | null>(null),
    [maximized, setMaximized] = useState(false);
  const previous = useRef<WindowRect | null>(null);
  const normalSize = useRef(initialSize);
  useEffect(() => {
    if (rect && !maximized)
      normalSize.current = { width: rect.width, height: rect.height };
  }, [rect, maximized]);
  useEffect(() => {
    if (!open) return;
    const size = viewport();
    setMaximized(false);
    setRect(centerWindow(normalSize.current, size));
  }, [open]);
  const gesture = useRef<{
    x: number;
    y: number;
    rect: WindowRect;
    edge?: ResizeEdge;
  } | null>(null);
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const size = viewport();
      setRect((current) =>
        maximized
          ? { x: 8, y: 8, width: size.width - 16, height: size.height - 16 }
          : fitWindow(
              current ?? {
                x: (size.width - 720) / 2,
                y: (size.height - 420) / 2,
                width: 720,
                height: 420,
              },
              size,
            ),
      );
    };
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [open, maximized]);
  const start = (event: PointerEvent<HTMLElement>, edge?: ResizeEdge) => {
    if (
      !rect ||
      maximized ||
      event.button !== 0 ||
      (!edge && (event.target as HTMLElement).closest("button"))
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { x: event.clientX, y: event.clientY, rect, edge };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y;
    setRect(
      g.edge
        ? resizeWindow(g.rect, g.edge, dx, dy, viewport())
        : fitWindow(
            { ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy },
            viewport(),
          ),
    );
  };
  const stop = () => {
    gesture.current = null;
  };
  const toggleMax = useCallback(() => {
    if (!rect) return;
    if (maximized) setRect(fitWindow(previous.current ?? rect, viewport()));
    else {
      previous.current = rect;
      const size = viewport();
      setRect({ x: 8, y: 8, width: size.width - 16, height: size.height - 16 });
    }
    setMaximized(!maximized);
  }, [rect, maximized]);
  return (
    <Dialog
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next && details.reason !== "close-press") {
          details.cancel();
          return;
        }
        if (!next) onClose();
      }}
    >
      <DialogPortal>
        <Primitive.Popup
          ref={popup}
          aria-describedby={
            title === t("ui.email")
              ? "workbench-mail-help"
              : "workbench-debug-help"
          }
          className="bg-popover text-popover-foreground fixed z-50 flex flex-col rounded-xl border shadow-xl outline-none"
          style={
            rect
              ? {
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                }
              : { visibility: "hidden" }
          }
        >
          <div
            className={cn(
              "bg-muted/50 flex h-11 shrink-0 touch-none items-center gap-2 rounded-t-xl border-b px-3 select-none",
              !maximized && "cursor-move",
            )}
            onPointerDown={(e) => start(e)}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
            onDoubleClick={(e) => {
              if (!(e.target as HTMLElement).closest("button")) toggleMax();
            }}
          >
            <DialogTitle
              className="min-w-0 flex-1 text-sm font-medium"
              tabIndex={0}
              onKeyDown={(e) => {
                if (
                  e.altKey &&
                  e.key.startsWith("Arrow") &&
                  rect &&
                  !maximized
                ) {
                  e.preventDefault();
                  setRect(
                    fitWindow(
                      {
                        ...rect,
                        x:
                          rect.x +
                          (e.key === "ArrowRight"
                            ? 20
                            : e.key === "ArrowLeft"
                              ? -20
                              : 0),
                        y:
                          rect.y +
                          (e.key === "ArrowDown"
                            ? 20
                            : e.key === "ArrowUp"
                              ? -20
                              : 0),
                      },
                      viewport(),
                    ),
                  );
                }
              }}
            >
              {title}
            </DialogTitle>
            <DialogDescription
              id={
                title === t("ui.email")
                  ? "workbench-mail-help"
                  : "workbench-debug-help"
              }
              className="sr-only"
            >
              {t("ui.dragTheTitleBarToMoveAndEdgesToResizeUseAlt")}
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                maximized ? t("ui.restoreWindow") : t("ui.maximizeWindow")
              }
              onClick={toggleMax}
            >
              {maximized ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    title === t("ui.email")
                      ? t("ui.closeMail")
                      : t("ui.closeLiveOutput")
                  }
                />
              }
            >
              <X />
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
          {!maximized &&
            edges.map((edge) => (
              <div
                key={edge}
                role="separator"
                tabIndex={0}
                aria-label={t("dynamic.resizeWindowFrom", {
                  p0: uiLabels_labels[edge],
                })}
                aria-valuetext={`${Math.round(rect?.width ?? 0)} × ${Math.round(rect?.height ?? 0)}`}
                className={cn(
                  "focus-visible:bg-primary/20 absolute touch-none focus-visible:outline-none",
                  handles[edge],
                )}
                onPointerDown={(e) => start(e, edge)}
                onPointerMove={move}
                onPointerUp={stop}
                onPointerCancel={stop}
                onLostPointerCapture={stop}
                onKeyDown={(e) => {
                  if (rect && e.key.startsWith("Arrow")) {
                    e.preventDefault();
                    setRect(
                      resizeWindow(
                        rect,
                        edge,
                        e.key === "ArrowRight"
                          ? 20
                          : e.key === "ArrowLeft"
                            ? -20
                            : 0,
                        e.key === "ArrowDown"
                          ? 20
                          : e.key === "ArrowUp"
                            ? -20
                            : 0,
                        viewport(),
                      ),
                    );
                  }
                }}
              />
            ))}
        </Primitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
