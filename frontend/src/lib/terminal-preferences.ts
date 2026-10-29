import { useEffect, useSyncExternalStore } from "react";

export const terminalFonts = {
  consolas: 'Consolas, "Microsoft YaHei", monospace',
  courier: '"Courier New", "Microsoft YaHei", monospace',
  system: 'ui-monospace, "Cascadia Mono", "Microsoft YaHei", monospace',
};
export const terminalThemes = {
  dark: {
    background: "#0f172a",
    foreground: "#e2e8f0",
    cursor: "#f8fafc",
    selectionBackground: "#475569",
    black: "#1e293b",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#e879f9",
    cyan: "#22d3ee",
    white: "#e2e8f0",
    brightBlack: "#94a3b8",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#f0abfc",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#fafafa",
    foreground: "#18181b",
    cursor: "#18181b",
    selectionBackground: "#cbd5e1",
    black: "#18181b",
    red: "#b91c1c",
    green: "#166534",
    yellow: "#854d0e",
    blue: "#1d4ed8",
    magenta: "#a21caf",
    cyan: "#0e7490",
    white: "#71717a",
    brightBlack: "#52525b",
    brightRed: "#dc2626",
    brightGreen: "#15803d",
    brightYellow: "#a16207",
    brightBlue: "#2563eb",
    brightMagenta: "#c026d3",
    brightCyan: "#0891b2",
    brightWhite: "#a1a1aa",
  },
};
export type TerminalPreferences = {
  fontSize: number;
  font: keyof typeof terminalFonts;
  lineHeight: number;
  theme: keyof typeof terminalThemes;
  cursor: "block" | "bar" | "underline";
  highlight: boolean;
};
export const defaultTerminalPreferences: TerminalPreferences = {
  fontSize: 13,
  font: "consolas",
  lineHeight: 1.2,
  theme: "dark",
  cursor: "block",
  highlight: false,
};
export function normalizeTerminalPreferences(
  value: Partial<TerminalPreferences>,
): TerminalPreferences {
  return {
    fontSize: Number.isFinite(value.fontSize)
      ? Math.min(28, Math.max(10, Math.round(value.fontSize!)))
      : 13,
    font:
      value.font && Object.hasOwn(terminalFonts, value.font)
        ? value.font
        : "consolas",
    lineHeight: Number.isFinite(value.lineHeight)
      ? Math.min(1.8, Math.max(1, value.lineHeight!))
      : 1.2,
    theme: value.theme === "light" ? "light" : "dark",
    cursor:
      value.cursor === "bar" || value.cursor === "underline"
        ? value.cursor
        : "block",
    highlight: value.highlight === true,
  };
}
let current = defaultTerminalPreferences;
let loaded = false;
const listeners = new Set<() => void>();
export const terminalPreferences = {
  snapshot: () => current,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  load: () => {
    if (loaded) return;
    loaded = true;
    try {
      current = normalizeTerminalPreferences(
        JSON.parse(localStorage.getItem("fae-terminal-view-v1") || "{}") || {},
      );
    } catch {
      /* defaults also work without storage */
    }
    listeners.forEach((fn) => fn());
  },
  set: (value: Partial<TerminalPreferences>) => {
    current = normalizeTerminalPreferences({ ...current, ...value });
    try {
      localStorage.setItem("fae-terminal-view-v1", JSON.stringify(current));
    } catch {
      /* session settings still apply */
    }
    listeners.forEach((fn) => fn());
  },
};
export function useTerminalPreferences() {
  const value = useSyncExternalStore(
    terminalPreferences.subscribe,
    terminalPreferences.snapshot,
    () => defaultTerminalPreferences,
  );
  useEffect(() => terminalPreferences.load(), []);
  return value;
}
