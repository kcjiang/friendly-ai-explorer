"use client";

import Container from "../container";
import { ThemeToggle } from "../theme-toggle";

export default function TopNav({ title }: { title: string }) {
  return (
    <Container className="border-border flex h-16 items-center justify-between border-b">
      <h1 className="text-2xl font-medium">{title}</h1>
      <ThemeToggle />
    </Container>
  );
}
