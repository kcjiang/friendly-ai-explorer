"use client";

import { useEffect, useRef, useState } from "react";
import { useUiTranslations } from "@/i18n/client";
import api from "@/lib/api";
import { FloatingWindow } from "./floating-window";

export function WorkbenchDebugConsole({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useUiTranslations();

  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const cursor = useRef(0),
    terminal = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await api.get<{
          events: { id: number; output: string }[];
        }>("/api/v1/workbench/debug", {
          params: { after: cursor.current },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const events = response.data.events;
        if (events.length) {
          cursor.current = events[events.length - 1].id;
          const node = terminal.current;
          const follow =
            !node ||
            node.scrollHeight - node.scrollTop - node.clientHeight < 40;
          setOutput((previous) =>
            (previous + events.map((event) => event.output).join("")).slice(
              -200000,
            ),
          );
          if (follow)
            requestAnimationFrame(() => {
              if (terminal.current)
                terminal.current.scrollTop = terminal.current.scrollHeight;
            });
        }
        setError("");
      } catch {
        if (!controller.signal.aborted)
          setError(t("ui.debugOutputDisconnectedReconnecting"));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, t]);
  return (
    <FloatingWindow open={open} onClose={onClose}>
      <pre
        ref={terminal}
        aria-label={t("ui.rawAiOutput")}
        className="h-full overflow-auto font-mono text-xs break-all whitespace-pre-wrap"
        role="log"
        aria-live="off"
      >
        {output || t("ui.waitingForAiOutput")}
        {error ? `\n${error}` : ""}
      </pre>
    </FloatingWindow>
  );
}
