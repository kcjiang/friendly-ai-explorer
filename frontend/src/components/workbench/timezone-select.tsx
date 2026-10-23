"use client";
import { useUiTranslations, translateLabels } from "@/i18n/client";

import { useMemo } from "react";
import { CatalogCombobox } from "@/components/catalog/catalog-ui";

const cities: Record<string, string> = {
  UTC: "Coordinated Universal Time",
  "Asia/Shanghai": "Shanghai",
  "Asia/Hong_Kong": "Hong Kong",
  "Asia/Jerusalem": "Jerusalem / Israel",
  "Asia/Tokyo": "Tokyo",
  "Asia/Seoul": "Seoul",
  "Asia/Singapore": "Singapore",
  "Asia/Dubai": "Dubai",
  "Asia/Kolkata": "India",
  "Asia/Calcutta": "India",
  "Europe/London": "London",
  "Europe/Paris": "Paris",
  "Europe/Berlin": "Berlin",
  "America/New_York": "New York",
  "America/Los_Angeles": "Los Angeles",
  "Australia/Sydney": "Sydney",
  "Pacific/Auckland": "Auckland",
};

export function TimezoneSelect({
  value,
  onChange,
  id,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useUiTranslations();

  const options = useMemo(() => {
    const uiLabels_cities = translateLabels(cities, t);
    const supported =
      (
        Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.("timeZone") ?? Object.keys(uiLabels_cities);
    return [
      ...new Set([
        "UTC",
        value,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...supported,
      ]),
    ]
      .filter(Boolean)
      .map((zone) => {
        let offset = "";
        try {
          offset =
            new Intl.DateTimeFormat("en", {
              timeZone: zone,
              timeZoneName: "shortOffset",
            })
              .formatToParts(new Date())
              .find((p) => p.type === "timeZoneName")
              ?.value.replace("GMT", "UTC") ?? "";
        } catch {
          /* Invalid saved values remain visible for correction. */
        }
        return {
          value: zone,
          label: `${zone}${uiLabels_cities[zone] ? ` · ${uiLabels_cities[zone]}` : ""} · ${offset}`,
        };
      });
  }, [value, t]);
  return (
    <CatalogCombobox
      id={id}
      label={t("ui.timeZone")}
      value={[value]}
      options={options}
      onChange={(values) => {
        if (values[0]) onChange(values[0]);
      }}
      popup
      searchable
      aria-invalid={invalid}
      aria-describedby={describedBy}
    />
  );
}
