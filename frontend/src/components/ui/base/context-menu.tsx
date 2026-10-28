"use client";

// Adapted from the shadcn Base Nova context menu composition.
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "@/lib/utils";
import { DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
function ContextMenuContent({
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50" sideOffset={4}>
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 z-50 min-w-44 rounded-lg p-1 shadow-md ring-1 outline-none",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuSeparator as ContextMenuSeparator,
};
