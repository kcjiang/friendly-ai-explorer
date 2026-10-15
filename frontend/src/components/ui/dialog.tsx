"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export const DialogContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, children, ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
    <Primitive.Content ref={ref} className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-background shadow-xl", className)} {...props}>
      {children}
      <Primitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /><span className="sr-only">关闭</span></Primitive.Close>
    </Primitive.Content>
  </Primitive.Portal>
));
DialogContent.displayName = "DialogContent";
