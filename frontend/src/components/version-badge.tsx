"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import { releaseNotes } from "@/config/release-notes";
import { translateLabels, useUiTranslations } from "@/i18n/client";
import { cn } from "@/lib/utils";
import packageInfo from "../../package.json";

const channels = {
  dev: {
    label: "Development",
    color:
      "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300 dark:hover:bg-purple-400/20",
  },
  beta: {
    label: "Beta",
    color:
      "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20",
  },
  rc: {
    label: "Release candidate",
    color:
      "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300 dark:hover:bg-cyan-400/20",
  },
  stable: {
    label: "Stable",
    color:
      "border-lime-200 bg-lime-50 text-lime-800 hover:bg-lime-100 dark:border-lime-400/30 dark:bg-lime-400/10 dark:text-lime-300 dark:hover:bg-lime-400/20",
  },
  preview: {
    label: "Preview",
    color:
      "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
  },
};

export function VersionBadge() {
  const t = useUiTranslations();
  const localizedChannels = translateLabels(channels, t);

  const localizedReleaseNotes = translateLabels(releaseNotes, t);

  const version = packageInfo.version;
  const prerelease = version.split("+")[0].split("-")[1]?.split(".")[0];
  const channel = !prerelease
    ? localizedChannels.stable
    : (localizedChannels[prerelease as keyof typeof localizedChannels] ??
      localizedChannels.preview);
  const history = Object.entries(localizedReleaseNotes);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={t("dynamic.versionVViewReleaseNotes", { p0: version })}
            className={cn(
              "group h-8 rounded-full px-2 text-xs tabular-nums shadow-none sm:px-3",
              channel.color,
            )}
          />
        }
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current"
        />
        <span className="hidden sm:inline">v{version}</span>
        <ChevronDown
          aria-hidden="true"
          className="hidden !h-3 !w-3 transition-transform group-data-[state=open]:rotate-180 sm:block"
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={12}
        aria-label={t("ui.versionReleaseNotes")}
        className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-xl p-0 shadow-xl"
      >
        <div className="border-b p-5">
          <h2 className="mb-2 text-lg font-semibold">{t("ui.releaseNotes")}</h2>
          <p className="text-muted-foreground text-xs">
            {t("ui.currentVersionV")}
            {version} · {channel.label} {t("ui.total3")}
            {history.length} {t("ui.versions")}
          </p>
        </div>
        <div
          tabIndex={0}
          aria-label={t("ui.releaseNoteContent")}
          className="focus-visible:ring-ring max-h-[min(440px,60dvh)] overflow-y-auto overscroll-contain p-5 text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          {!localizedReleaseNotes[version] && (
            <p className="text-muted-foreground mb-4">
              {t("ui.noReleaseNotesForThisVersion")}
            </p>
          )}
          {history.length > 0 ? (
            history.map(([releaseVersion, notes]) => (
              <section
                key={releaseVersion}
                aria-label={t("dynamic.vReleaseNotes", { p0: releaseVersion })}
                className="mb-5 border-b pb-5 last:mb-0 last:border-0 last:pb-0"
              >
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="font-semibold tabular-nums">
                    v{releaseVersion}
                  </h3>
                  {releaseVersion === version && (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs",
                        channel.color,
                      )}
                    >
                      {t("ui.currentVersion")}
                    </span>
                  )}
                </div>
                <p className="mb-3 font-medium">{notes.title}</p>
                <ul className="text-muted-foreground list-disc space-y-3 pl-4 leading-relaxed">
                  {notes.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="text-muted-foreground">
              {t("ui.noEarlierReleaseNotes")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
