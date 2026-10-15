import * as React from "react";
import { cn } from "@/lib/utils";
export function Table({ className, ...props }: React.ComponentProps<"table">) { return <div className="relative w-full overflow-auto"><table className={cn("w-full caption-bottom text-sm", className)} {...props} /></div>; }
export function TableHeader(props: React.ComponentProps<"thead">) { return <thead className="border-b bg-muted/50" {...props} />; }
export function TableBody(props: React.ComponentProps<"tbody">) { return <tbody className="[&_tr:last-child]:border-0" {...props} />; }
export function TableRow({ className, ...props }: React.ComponentProps<"tr">) { return <tr className={cn("border-b transition-colors hover:bg-muted/50", className)} {...props} />; }
export function TableHead(props: React.ComponentProps<"th">) { return <th className="h-12 whitespace-nowrap px-4 text-left font-medium text-muted-foreground" {...props} />; }
export function TableCell({ className, ...props }: React.ComponentProps<"td">) { return <td className={cn("p-4 align-middle", className)} {...props} />; }
