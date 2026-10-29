"use client";

import { useEffect, useRef } from "react";
import styles from "./dgx-spark.module.css";

function DecorativeLight({ side }: { side: "left" | "right" }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    let lit = false;
    function blink() {
      if (!element || document.hidden) return;
      lit = !lit;
      element.dataset.lit = String(lit);
      // Network-port effect: mostly lit, with independent, very brief dark gaps.
      const fast = Math.random() < 0.82;
      const delay = lit
        ? (motion.matches ? 2 : 1) *
          (side === "left"
            ? fast
              ? 180 + Math.random() * 240
              : 700 + Math.random() * 500
            : fast
              ? 300 + Math.random() * 350
              : 1100 + Math.random() * 700)
        : 18 + Math.random() * 17;
      timer = setTimeout(blink, delay);
    }
    function restart() {
      clearTimeout(timer);
      lit = true;
      if (element) element.dataset.lit = "true";
      if (!document.hidden)
        timer = setTimeout(blink, 180 + Math.random() * 400);
    }
    restart();
    document.addEventListener("visibilitychange", restart);
    motion.addEventListener("change", restart);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", restart);
      motion.removeEventListener("change", restart);
    };
  }, [side]);
  return (
    <span
      ref={ref}
      data-lit="true"
      className={`${styles.light} ${styles[side]}`}
    />
  );
}

export default function AIBrand() {
  return (
    <div className="border-border/70 relative isolate mx-3 mb-4 flex shrink-0 flex-col items-center gap-2.5 border-t pt-4 text-center">
      <div className={`dot-matrix ${styles.backdrop}`} aria-hidden="true" />
      <span className="text-muted-foreground text-[10px] font-medium tracking-[0.16em] uppercase">
        Powered by
      </span>
      <div className={styles.device} aria-hidden="true">
        <span className={styles.body} />
        <div className={styles.side}>
          <span className={styles.edge} />
          <DecorativeLight side="left" />
        </div>
        <div className={`${styles.side} ${styles.mirrored}`}>
          <span className={styles.edge} />
          <DecorativeLight side="right" />
        </div>
      </div>
      <span className="text-foreground text-[13px] leading-5 font-semibold tracking-tight whitespace-nowrap">
        NVIDIA DGX Spark
      </span>
    </div>
  );
}
