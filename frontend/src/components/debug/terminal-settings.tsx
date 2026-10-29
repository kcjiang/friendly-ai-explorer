"use client";

import { Settings2 } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import { NativeSelect } from "@/components/ui/base/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import {
  type TerminalPreferences,
  defaultTerminalPreferences,
  terminalPreferences,
  useTerminalPreferences,
} from "@/lib/terminal-preferences";

export default function TerminalSettings() {
  const zh = useLocale() === "zh-CN";
  const p = useTerminalPreferences();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={zh ? "显示设置" : "Display settings"}
            title={zh ? "显示设置" : "Display settings"}
          />
        }
      >
        <Settings2 />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <PopoverTitle>{zh ? "终端显示" : "Terminal display"}</PopoverTitle>
        <Label className="grid gap-1">
          {zh ? "字号（Ctrl/⌘ + 加减号）" : "Font size (Ctrl/⌘ + +/-)"}
          <Input
            type="number"
            min={10}
            max={28}
            value={p.fontSize}
            onChange={(e) =>
              terminalPreferences.set({ fontSize: Number(e.target.value) })
            }
          />
        </Label>
        <Label className="grid gap-1">
          {zh ? "字体" : "Font"}
          <NativeSelect
            value={p.font}
            onChange={(e) =>
              terminalPreferences.set({
                font: e.target.value as TerminalPreferences["font"],
              })
            }
          >
            <option value="consolas">Consolas + 微软雅黑</option>
            <option value="courier">Courier New + 微软雅黑</option>
            <option value="system">System monospace + 中文</option>
          </NativeSelect>
        </Label>
        <Label className="grid gap-1">
          {zh ? "行间距" : "Line height"}
          <NativeSelect
            value={p.lineHeight}
            onChange={(e) =>
              terminalPreferences.set({ lineHeight: Number(e.target.value) })
            }
          >
            {[1, 1.2, 1.4, 1.6, 1.8].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="grid gap-1">
          {zh ? "主题与 ANSI 配色" : "Theme and ANSI palette"}
          <NativeSelect
            value={p.theme}
            onChange={(e) =>
              terminalPreferences.set({
                theme: e.target.value as TerminalPreferences["theme"],
              })
            }
          >
            <option value="dark">{zh ? "深色" : "Dark"}</option>
            <option value="light">{zh ? "浅色" : "Light"}</option>
          </NativeSelect>
        </Label>
        <Label className="grid gap-1">
          {zh ? "光标" : "Cursor"}
          <NativeSelect
            value={p.cursor}
            onChange={(e) =>
              terminalPreferences.set({
                cursor: e.target.value as TerminalPreferences["cursor"],
              })
            }
          >
            <option value="block">{zh ? "方块" : "Block"}</option>
            <option value="bar">{zh ? "竖线" : "Bar"}</option>
            <option value="underline">{zh ? "下划线" : "Underline"}</option>
          </NativeSelect>
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={p.highlight}
            onCheckedChange={(v) =>
              terminalPreferences.set({ highlight: v === true })
            }
          />
          {zh
            ? "标记 ERROR / WARN（保留原配色）"
            : "Mark ERROR / WARN (preserve ANSI colors)"}
        </Label>
        <Button
          variant="outline"
          onClick={() => terminalPreferences.set(defaultTerminalPreferences)}
        >
          {zh ? "恢复默认显示" : "Reset display"}
        </Button>
        <p className="text-muted-foreground text-xs">
          {zh
            ? "设置同时应用于设备终端和控制台日志，不会断开连接。"
            : "Settings apply to terminal and console logs without disconnecting."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
