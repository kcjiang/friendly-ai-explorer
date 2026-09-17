"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { releaseNotes } from "@/config/release-notes";
import { cn } from "@/lib/utils";
import packageInfo from "../../package.json";

const channels = {
  dev: { label: "开发版", color: "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300 dark:hover:bg-purple-400/20" },
  beta: { label: "测试版", color: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20" },
  rc: { label: "候选版", color: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300 dark:hover:bg-cyan-400/20" },
  stable: { label: "正式版", color: "border-lime-200 bg-lime-50 text-lime-800 hover:bg-lime-100 dark:border-lime-400/30 dark:bg-lime-400/10 dark:text-lime-300 dark:hover:bg-lime-400/20" },
  preview: { label: "预览版", color: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" },
};

export function VersionBadge() {
  const version = packageInfo.version;
  const prerelease = version.split("+")[0].split("-")[1]?.split(".")[0];
  const channel = !prerelease ? channels.stable : channels[prerelease as keyof typeof channels] ?? channels.preview;
  const history = Object.entries(releaseNotes);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`版本 v${version}，查看发布说明`} className={cn("group h-8 rounded-full px-3 text-xs tabular-nums shadow-none", channel.color)}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          v{version}
          <ChevronDown aria-hidden="true" className="!h-3 !w-3 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={12} collisionPadding={16} aria-label="版本发布说明" className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-xl p-0 shadow-xl">
        <div className="border-b p-5">
          <h2 className="mb-2 text-lg font-semibold">发布说明</h2>
          <p className="text-xs text-muted-foreground">当前版本 v{version} · {channel.label} · 共 {history.length} 个版本</p>
        </div>
        <div tabIndex={0} aria-label="发布说明内容" className="max-h-[min(440px,60dvh)] overflow-y-auto overscroll-contain p-5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          {!releaseNotes[version] && <p className="mb-4 text-muted-foreground">当前版本暂无发布说明。</p>}
          {history.length > 0 ? history.map(([releaseVersion, notes]) => (
            <section key={releaseVersion} aria-label={`v${releaseVersion} 发布说明`} className="mb-5 border-b pb-5 last:mb-0 last:border-0 last:pb-0">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-semibold tabular-nums">v{releaseVersion}</h3>
                {releaseVersion === version && <span className={cn("rounded-full border px-2 py-0.5 text-xs", channel.color)}>当前版本</span>}
              </div>
              <p className="mb-3 font-medium">{notes.title}</p>
              <ul className="list-disc space-y-3 pl-4 leading-relaxed text-muted-foreground">{notes.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          )) : <p className="text-muted-foreground">暂无历史发布说明。</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
