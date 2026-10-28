"use client";

import { type ReactNode, useEffect, useRef } from "react";
import styles from "./device-console.module.css";
import { useDeviceText } from "./device-tools";

export default function DeviceLogActions({
  children,
}: {
  children: ReactNode;
}) {
  const d = useDeviceText();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let offset = { x: 0, y: 0 };
    const align = () => {
      if (!element.clientWidth) return;
      const rect = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const x = rect.left - offset.x;
      const y = rect.top - offset.y;
      // Resizable panels can end on fractional pixels; don't rasterize thin
      // button borders between physical pixels, especially at browser zoom.
      offset = {
        x: Math.round(x * ratio) / ratio - x,
        y: Math.round(y * ratio) / ratio - y,
      };
      element.style.setProperty("--log-snap-x", `${offset.x}px`);
      element.style.setProperty("--log-snap-y", `${offset.y}px`);
    };
    const observer = new ResizeObserver(align);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", align);
    };
  }, []);
  return (
    <div
      ref={host}
      className={styles.logActions}
      role="toolbar"
      aria-label={d("Log actions", "日志操作")}
    >
      {children}
    </div>
  );
}
