import type { ReactNode } from "react";
import Container from "@/components/container";

export default function PageToolbar({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Container
      role="toolbar"
      aria-label={label}
      data-page-toolbar
      className="flex shrink-0 flex-wrap items-center gap-2 border-b py-2"
    >
      {children}
    </Container>
  );
}
