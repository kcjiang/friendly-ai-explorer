import Link from "next/link";
import { GeminiLogo } from "@/components/icons";

export default function GeminiBrand() {
  return (
    <Link
      href="https://aistudio.google.com"
      target="_blank"
      className="relative my-2 flex flex-col items-center justify-center gap-y-2 px-4 py-4"
    >
      <div className="dot-matrix absolute left-0 top-0 -z-10 h-full w-full" />
      <span className="text-xs text-muted-foreground">Powered by</span>
      <div className="flex items-center space-x-2">
        <GeminiLogo size={24} />
        <span className="text-md text-accent-foreground">Gemini 2.5</span>
      </div>
    </Link>
  );
}
