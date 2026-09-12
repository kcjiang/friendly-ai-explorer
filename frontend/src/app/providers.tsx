"use client";

import { Provider as JotaiProvider } from "jotai";
import { SessionProvider } from "next-auth/react";
import { ChartThemeProvider } from "@/components/providers/chart-theme-provider";
import { ModeThemeProvider } from "@/components/providers/mode-theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <JotaiProvider>
        <ModeThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ChartThemeProvider>{children}</ChartThemeProvider>
        </ModeThemeProvider>
      </JotaiProvider>
    </SessionProvider>
  );
}
