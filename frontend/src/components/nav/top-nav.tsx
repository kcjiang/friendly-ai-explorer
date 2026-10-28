"use client";

import Container from "../container";
import { ThemeToggle } from "../theme-toggle";

export default function TopNav({ title }: { title: string }) {
  return (
    <Container className="border-border flex h-16 shrink-0 items-center justify-between gap-3 border-b">
      <h1
        className="min-w-0 truncate text-lg font-medium sm:text-2xl"
        title={title}
      >
        {title}
      </h1>
      <ThemeToggle />
    </Container>
  );
}
