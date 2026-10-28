"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/base/resizable";
import styles from "./device-console.module.css";
import { useDeviceText } from "./device-tools";

export default function DeviceConsoleWorkspace({
  media,
  remote,
  logs,
}: {
  media: ReactNode;
  remote: ReactNode;
  logs: ReactNode;
}) {
  const d = useDeviceText();
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    height: number;
    narrow: boolean;
    videoMaxHeight: number;
  } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => {
      if (!element.clientWidth) return;
      const narrow = window.matchMedia("(max-width: 1023px)").matches;
      const scrollTop =
        element.closest("[data-device-console]")?.parentElement?.scrollTop ?? 0;
      const height = Math.max(
        narrow ? 920 : 540,
        Math.floor(
          window.innerHeight -
            element.getBoundingClientRect().top -
            scrollTop -
            16,
        ),
      );
      // VideoArea has 8px padding on every side. Stop at its full-width 16:9 frame.
      const videoMaxHeight = Math.floor(
        ((element.clientWidth - 16) * 9) / 16 + 16,
      );
      setLayout((old) =>
        old?.height === height &&
        old.narrow === narrow &&
        old.videoMaxHeight === videoMaxHeight
          ? old
          : { height, narrow, videoMaxHeight },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const toolbar = element
      .closest("[data-device-console]")
      ?.querySelector("[data-page-toolbar]");
    if (toolbar) observer.observe(toolbar);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  const handle = (label: string) => (
    <ResizableHandle withHandle className={styles.handle} aria-label={label} />
  );
  return (
    <div
      ref={host}
      className={styles.workspace}
      style={{ height: layout?.height ?? 720 }}
      data-console-workspace
    >
      {layout &&
        (layout.narrow ? (
          <ResizablePanelGroup orientation="vertical" key="mobile-console">
            <ResizablePanel
              id="console-video-mobile"
              defaultSize={layout.videoMaxHeight}
              minSize={Math.min(120, layout.videoMaxHeight)}
              maxSize={layout.videoMaxHeight}
            >
              {media}
            </ResizablePanel>
            {handle(d("Resize video and remote areas", "调整视频与遥控器高度"))}
            <ResizablePanel
              id="console-remote-mobile"
              defaultSize="47%"
              minSize={240}
            >
              <div className={styles.remote} data-device-remote>
                {remote}
              </div>
            </ResizablePanel>
            {handle(d("Resize remote and log areas", "调整遥控器与日志区高度"))}
            <ResizablePanel
              id="console-logs-mobile"
              defaultSize="25%"
              minSize={160}
            >
              {logs}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ResizablePanelGroup orientation="horizontal" key="desktop-console">
            <ResizablePanel id="console-left" minSize="40%">
              <ResizablePanelGroup orientation="vertical">
                <ResizablePanel
                  id="console-video"
                  defaultSize="70%"
                  minSize={180}
                >
                  {media}
                </ResizablePanel>
                {handle(
                  d("Resize capture and log areas", "调整采集区与日志区高度"),
                )}
                <ResizablePanel
                  id="console-logs"
                  defaultSize="30%"
                  minSize={160}
                >
                  {logs}
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            {handle(
              d(
                "Resize left workspace and remote",
                "调整左侧工作区与遥控器宽度",
              ),
            )}
            <ResizablePanel
              id="console-remote"
              defaultSize={Math.max(
                216,
                Math.ceil(((layout.height - 32) * 326) / 1080 + 56),
              )}
              minSize={216}
              maxSize="45%"
            >
              <div className={styles.remote} data-device-remote>
                {remote}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ))}
    </div>
  );
}
