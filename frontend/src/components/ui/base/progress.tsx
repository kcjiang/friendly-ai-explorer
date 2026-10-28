"use client";

// Source: https://ui.shadcn.com/r/styles/base-nova/progress.json
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/lib/utils";

function Progress({ className, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("w-full", className)}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full"
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="bg-primary h-full rounded-full transition-[width] data-indeterminate:w-1/3 data-indeterminate:animate-pulse"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}
export { Progress };
