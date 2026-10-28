"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { DeviceSession } from "@/lib/device-session";

export default function TerminalView({
  session,
  report,
}: {
  session: DeviceSession;
  report: (error: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      .then(([{ Terminal }, { FitAddon }]) => {
        if (disposed || !host.current) return;
        const terminal = new Terminal({
          disableStdin: session.snapshot().status !== "connected",
          cursorBlink: true,
          fontSize: 13,
          scrollback: 10000,
          theme: { background: "#0f172a", foreground: "#e2e8f0" },
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(host.current);
        terminal.write(session.transcript);
        const unsubscribe = session.receive((data) => terminal.write(data));
        const stateUnsubscribe = session.subscribe(() => {
          terminal.options.disableStdin =
            session.snapshot().status !== "connected";
        });
        const input = terminal.onData((data) => {
          void session.write(data).catch((error) => reportRef.current(error));
        });
        const resize = new ResizeObserver(() => {
          if (host.current?.clientWidth && host.current?.clientHeight)
            fit.fit();
        });
        resize.observe(host.current);
        cleanup = () => {
          resize.disconnect();
          input.dispose();
          unsubscribe();
          stateUnsubscribe();
          terminal.dispose();
        };
      })
      .catch((error) => reportRef.current(error));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [session]);
  return (
    <div className="h-full min-h-0 min-w-0 bg-slate-900 p-3">
      <div ref={host} className="h-full min-h-0 min-w-0" />
    </div>
  );
}
