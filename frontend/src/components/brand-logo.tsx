import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandLogo({
  brand,
  className,
}: {
  brand: "sdmc" | "fae";
  className?: string;
}) {
  const file = brand === "sdmc" ? "SDMC-2026-0803" : "FAE-2026-0917";
  return (
    <span className={cn("relative block shrink-0", className)}>
      <Image
        src={`/images/${file}.png`}
        alt={`${brand.toUpperCase()} Logo`}
        fill
        sizes="160px"
        priority
        className="object-contain dark:hidden"
      />
      <Image
        src={`/images/${file}-white.png`}
        alt={`${brand.toUpperCase()} Logo`}
        fill
        sizes="160px"
        priority
        className="hidden object-contain dark:block"
      />
    </span>
  );
}
