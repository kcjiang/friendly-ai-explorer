"use client";

import { useMemo } from "react";
import { CatalogCombobox } from "@/components/catalog/catalog-ui";

const cities: Record<string, string> = {
  UTC: "协调世界时",
  "Asia/Shanghai": "上海",
  "Asia/Hong_Kong": "香港",
  "Asia/Jerusalem": "耶路撒冷 / 以色列",
  "Asia/Tokyo": "东京",
  "Asia/Seoul": "首尔",
  "Asia/Singapore": "新加坡",
  "Asia/Dubai": "迪拜",
  "Asia/Kolkata": "印度",
  "Asia/Calcutta": "印度",
  "Europe/London": "伦敦",
  "Europe/Paris": "巴黎",
  "Europe/Berlin": "柏林",
  "America/New_York": "纽约",
  "America/Los_Angeles": "洛杉矶",
  "Australia/Sydney": "悉尼",
  "Pacific/Auckland": "奥克兰",
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
  const options = useMemo(() => {
    const supported =
      (
        Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.("timeZone") ?? Object.keys(cities);
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
          label: `${zone}${cities[zone] ? ` · ${cities[zone]}` : ""} · ${offset}`,
        };
      });
  }, [value]);
  return (
    <CatalogCombobox
      id={id}
      label="时区"
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
