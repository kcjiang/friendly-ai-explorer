"use client";

import { useUiTranslations } from "@/i18n/client";
import Image from "next/image";

export default function AIBrand() {
  const t = useUiTranslations();

  return (
    <div className="mx-3 mb-4 flex shrink-0 flex-col items-center border-t border-border/70 pt-4 text-center">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Powered by
      </span>
      <Image
        src="/nvidia-dgx-spark.svg"
        alt="NVIDIA DGX Spark"
        width={72}
        height={52}
        className="mb-2 mt-3 h-[52px] w-[72px] opacity-80 dark:invert"
      />
      <span className="text-sm font-semibold tracking-tight text-foreground">
        2× DGX Spark
      </span>
      <div className="mt-3 space-y-0.5">
        <p className="text-xl font-medium leading-7 tracking-tight text-foreground">
          128{" "}
          <span className="text-sm font-normal text-muted-foreground">GB</span>
        </p>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {t("ui.upTo200bParameters")}
        </p>
      </div>
    </div>
  );
}
