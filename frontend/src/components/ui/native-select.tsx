import * as React from "react";
import { cn } from "@/lib/utils";
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn("h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60", className)} {...props} />;
}
