"use client";

import { useEffect, useRef } from "react";

/** Poll serially; cancel stale work and pause network requests in background tabs. */
export function usePolling(
  callback: (signal: AbortSignal) => Promise<unknown>,
  interval: number,
  enabled = true,
  immediate = true,
  onError?: (error: unknown) => void,
) {
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (document.visibilityState !== "hidden")
          await callback(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) errorHandler.current?.(error);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, interval);
      }
    }
    if (immediate) void poll();
    else timer = setTimeout(poll, interval);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [callback, interval, enabled, immediate]);
}
