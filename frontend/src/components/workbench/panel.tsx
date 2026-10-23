"use client";

import type { ReactNode } from "react";
import { TabsContent } from "@/components/ui/base/tabs";

// Desktop shows both columns. Mobile keeps the official tab/tabpanel association.
export function WorkbenchPanel({
  wide,
  value,
  children,
  ...props
}: {
  wide: boolean;
  value: string;
  children: ReactNode;
  className?: string;
  "aria-label": string;
}) {
  return wide ? (
    <section {...props}>{children}</section>
  ) : (
    <TabsContent value={value} keepMounted {...props}>
      {children}
    </TabsContent>
  );
}
