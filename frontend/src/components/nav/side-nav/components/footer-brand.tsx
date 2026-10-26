"use client";

import Image from "next/image";
import { useUiTranslations } from "@/i18n/client";

export default function AIBrand() {
  const t = useUiTranslations();

  return (
    <div className="border-border/70 mx-3 mb-4 flex shrink-0 flex-col items-center border-t pt-4 text-center">
      <span className="text-muted-foreground text-[10px] font-medium tracking-[0.16em] uppercase">
        Powered by
      </span>
      <Image
        src="/nvidia-dgx-spark.svg"
        alt="NVIDIA DGX Spark"
        width={72}
        height={52}
        className="mt-3 mb-2 h-[52px] w-[72px] opacity-80 dark:invert"
      />
      <span className="text-foreground text-sm font-semibold tracking-tight">
        2× DGX Spark
      </span>
      <div className="mt-3 space-y-0.5">
        <p className="text-foreground text-xl leading-7 font-medium tracking-tight">
          128{" "}
          <span className="text-muted-foreground text-sm font-normal">GB</span>
        </p>
        <p className="text-muted-foreground text-[11px] leading-5">
          {t("ui.upTo200bParameters")}
        </p>
      </div>
    </div>
  );
}
