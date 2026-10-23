"use client";

import { useUiTranslations } from "@/i18n/client";
import { CirclePercent } from "lucide-react";
import { convertions } from "@/data/convertions";
import { addThousandsSeparator } from "@/lib/utils";
import ChartTitle from "../../components/chart-title";
import Chart from "./chart";

export default function Convertions() {
  const t = useUiTranslations();

  return (
    <section className="flex h-full flex-col gap-2">
      <ChartTitle title={t("ui.additionalConversions")} icon={CirclePercent} />
      <Indicator />
      <div className="relative max-h-80 flex-grow">
        <Chart />
      </div>
    </section>
  );
}

function Indicator() {
  const t = useUiTranslations();

  return (
    <div className="mt-3">
      <span className="mr-1 text-2xl font-medium">
        {addThousandsSeparator(
          convertions.reduce((acc, curr) => acc + curr.value, 0),
        )}
      </span>
      <span className="text-muted-foreground/60">
        {t("ui.additionalSales")}
      </span>
    </div>
  );
}
