import { cn } from "@/lib/utils";

// shadcn Item composition: https://ui.shadcn.com/docs/components/base/item
function Item({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-transparent p-3 text-sm",
        className,
      )}
      {...props}
    />
  );
}
function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  );
}
function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("flex items-center gap-2 text-sm font-medium", className)}
      {...props}
    />
  );
}
function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn("text-muted-foreground text-xs leading-relaxed", className)}
      {...props}
    />
  );
}
export { Item, ItemContent, ItemTitle, ItemDescription };
