"use client";

import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/base/field";
import { Input } from "@/components/ui/base/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/base/native-select";
import { useUiTranslations } from "@/i18n/client";
import type { Schedule } from "@/types/workbench";
import { TimezoneSelect } from "./timezone-select";

export function ScheduleForm({
  schedule,
  onChange,
  errors,
}: {
  schedule: Schedule;
  onChange: (value: Schedule) => void;
  errors: Record<string, string>;
}) {
  const t = useUiTranslations();
  return (
    <FieldGroup>
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id="workbench-field-2"
          checked={schedule.enabled}
          onCheckedChange={(enabled) =>
            onChange({ ...schedule, enabled: !!enabled })
          }
        />
        <FieldLabel htmlFor="workbench-field-2">
          {t("ui.enableScheduledCollection")}
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel htmlFor="workbench-field-3">
          {t("ui.collectionInterval")}
        </FieldLabel>
        <NativeSelect
          id="workbench-field-3"
          value={schedule.interval_minutes}
          onChange={(e) =>
            onChange({
              ...schedule,
              interval_minutes: Number(e.target.value),
            })
          }
        >
          {[15, 30, 60, 120, 180, 240].map((n) => (
            <NativeSelectOption key={n} value={n}>
              {n < 60
                ? t("dynamic.othermessage27", { p0: n })
                : t("dynamic.othermessage28", { p0: n / 60 })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <div>
        <p className="mb-2">{t("ui.weekdays")}</p>
        <div className="flex flex-wrap gap-4">
          {[
            t("ui.mon"),
            t("ui.tue"),
            t("ui.wed"),
            t("ui.thu"),
            t("ui.fri"),
            t("ui.sat"),
            t("ui.sun"),
          ].map((day, i) => (
            <Field key={day} orientation="horizontal" className="w-auto">
              <Checkbox
                id={`workbench-field-4-${i}`}
                checked={schedule.weekdays.includes(i)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...schedule,
                    weekdays: checked
                      ? [...schedule.weekdays, i]
                      : schedule.weekdays.filter((d) => d !== i),
                  })
                }
              />
              <FieldLabel htmlFor={`workbench-field-4-${i}`}>
                {t("ui.week")}
                {day}
              </FieldLabel>
            </Field>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="workbench-field-5">
            {t("ui.startTime")}
          </FieldLabel>
          <Input
            id="workbench-field-5"
            aria-invalid={!!errors["workbench-field-5"]}
            aria-describedby={
              errors["workbench-field-5"]
                ? "workbench-field-5-error"
                : undefined
            }
            type="time"
            value={schedule.start}
            onChange={(e) =>
              onChange({
                ...schedule,
                start: e.target.value,
              })
            }
          />
          {errors["workbench-field-5"] && (
            <FieldError id="workbench-field-5-error">
              {errors["workbench-field-5"]}
            </FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="workbench-field-6">{t("ui.endTime")}</FieldLabel>
          <Input
            id="workbench-field-6"
            aria-invalid={!!errors["workbench-field-6"]}
            aria-describedby={
              errors["workbench-field-6"]
                ? "workbench-field-6-error"
                : undefined
            }
            type="time"
            value={schedule.end}
            onChange={(e) => onChange({ ...schedule, end: e.target.value })}
          />
          {errors["workbench-field-6"] && (
            <FieldError id="workbench-field-6-error">
              {errors["workbench-field-6"]}
            </FieldError>
          )}
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="workbench-field-7">{t("ui.timeZone")}</FieldLabel>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 [&>button]:overflow-hidden [&>button]:text-ellipsis [&>button]:whitespace-nowrap">
            <TimezoneSelect
              id="workbench-field-7"
              value={schedule.timezone}
              onChange={(timezone) => onChange({ ...schedule, timezone })}
              invalid={!!errors["workbench-field-7"]}
              describedBy={
                errors["workbench-field-7"]
                  ? "workbench-field-7-error"
                  : undefined
              }
            />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              onChange({
                ...schedule,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })
            }
          >
            {t("ui.useBrowserTimeZone")}
          </Button>
        </div>
        {errors["workbench-field-7"] && (
          <FieldError id="workbench-field-7-error">
            {errors["workbench-field-7"]}
          </FieldError>
        )}
      </Field>
      <p className="text-muted-foreground text-xs">
        {t("ui.runsAtIntervalsFromTheStartTimeWorkingHoursAreCheckedBefore")}
      </p>
    </FieldGroup>
  );
}
