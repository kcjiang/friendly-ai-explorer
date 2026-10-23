"use client";

import { useUiTranslations } from "@/i18n/client";
import { Rss } from "lucide-react";
import ChartTitle from "../../components/chart-title";
import Chart from "./chart";

export default function TicketByChannels() {
  const t = useUiTranslations();

  return (
    <section className="flex h-full flex-col gap-2">
      <ChartTitle title={t("ui.additionalTicketByChannels")} icon={Rss} />
      <div className="relative flex min-h-64 flex-grow flex-col justify-center">
        <Chart />
      </div>
    </section>
  );
}
