"use client";

// Adapted from the shadcn Base Nova menubar composition.
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive>) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn(
        "flex h-8 items-center gap-0.5 rounded-lg border p-[3px]",
        className,
      )}
      {...props}
    />
  );
}
function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuTrigger>) {
  return (
    <DropdownMenuTrigger
      data-slot="menubar-trigger"
      className={cn(
        "hover:bg-muted aria-expanded:bg-muted flex items-center rounded-sm px-1.5 py-0.5 text-sm font-medium outline-none select-none",
        className,
      )}
      {...props}
    />
  );
}
export {
  Menubar,
  DropdownMenu as MenubarMenu,
  MenubarTrigger,
  DropdownMenuContent as MenubarContent,
  DropdownMenuItem as MenubarItem,
  DropdownMenuSeparator as MenubarSeparator,
};
