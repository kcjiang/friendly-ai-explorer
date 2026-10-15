import * as React from "react";
import { cn } from "@/lib/utils";
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60", className)} {...props} />;
}
