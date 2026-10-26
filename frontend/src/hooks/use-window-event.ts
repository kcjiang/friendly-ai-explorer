"use client";

import { useEffect, useRef } from "react";

/** Subscribe once per event name while always calling the latest handler. */
export function useWindowEvent(type: string, handler: (event: Event) => void) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = (event: Event) => handlerRef.current(event);
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
  }, [type]);
}
