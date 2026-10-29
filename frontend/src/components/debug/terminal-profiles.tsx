"use client";

import { Bookmark } from "lucide-react";
import { useLocale } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import { NativeSelect } from "@/components/ui/base/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/base/popover";
import { useFeedback } from "@/components/ui/feedback-provider";
import type { DeviceSession } from "@/lib/device-session";
import {
  type TerminalProfile,
  applyProfile,
  captureProfile,
  readProfiles,
  saveProfiles,
} from "@/lib/terminal-profiles";

export default function TerminalProfiles({
  session,
}: {
  session: DeviceSession;
}) {
  const zh = useLocale() === "zh-CN";
  const { confirm } = useFeedback();
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const reload = () => {
    try {
      setProfiles(readProfiles());
      setStorageReady(true);
      setError("");
    } catch (e) {
      setError(String(e));
      setStorageReady(false);
    }
  };
  useEffect(reload, []);
  const run = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const disabled = !["disconnected", "error"].includes(state.status);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) reload();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            title={
              session.profileName || (zh ? "会话配置" : "Session profiles")
            }
          />
        }
      >
        <Bookmark />
        {session.profileName || (zh ? "会话配置" : "Profiles")}
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 p-3" align="start">
        <PopoverTitle>
          {zh ? "命名会话配置" : "Named session profiles"}
        </PopoverTitle>
        <Label className="grid gap-1">
          {zh ? "已保存配置" : "Saved profiles"}
          <NativeSelect
            aria-label={zh ? "已保存配置" : "Saved profiles"}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setName(
                profiles.find((p) => p.id === e.target.value)?.name || "",
              );
            }}
          >
            <option value="">{zh ? "新配置" : "New profile"}</option>
            {profiles
              .filter((p) => p.kind === session.kind)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <Label className="grid gap-1">
          {zh ? "配置名称" : "Profile name"}
          <Input
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Label>
        <Label className="grid gap-1">
          {zh ? "粘贴发送间隔（ms）" : "Paste delay (ms)"}
          <Input
            type="number"
            min={0}
            max={5000}
            value={session.pasteDelayMs}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 0 && value <= 5000)
                session.configure({ pasteDelayMs: value });
            }}
          />
        </Label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!selected || disabled || !storageReady}
            onClick={() =>
              run(() => {
                const profile = profiles.find((p) => p.id === selected);
                if (profile) applyProfile(session, profile);
              })
            }
          >
            {zh ? "载入配置" : "Load profile"}
          </Button>
          <Button
            variant="outline"
            disabled={!name.trim() || !storageReady}
            onClick={() =>
              run(() => {
                const latest = readProfiles();
                const profile = captureProfile(
                  session,
                  name,
                  selected || undefined,
                );
                const next = [
                  ...latest.filter((p) => p.id !== profile.id),
                  profile,
                ];
                saveProfiles(next);
                setProfiles(next);
                setSelected(profile.id);
                session.configure({ profileName: profile.name });
              })
            }
          >
            {selected
              ? zh
                ? "更新配置"
                : "Update profile"
              : zh
                ? "保存当前配置"
                : "Save current settings"}
          </Button>
          <Button
            variant="outline"
            disabled={!selected || !storageReady}
            onClick={() => {
              void (async () => {
                if (
                  await confirm(
                    zh
                      ? "删除这份会话配置？不会删除日志文件。"
                      : "Delete this profile? Log files are kept.",
                  )
                )
                  run(() => {
                    const next = readProfiles().filter(
                      (p) => p.id !== selected,
                    );
                    saveProfiles(next);
                    setProfiles(next);
                    setSelected("");
                    setName("");
                  });
              })();
            }}
          >
            {zh ? "删除配置" : "Delete profile"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-xs break-words">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {zh
            ? "保存当前参数、编码、换行、粘贴间隔、显示和日志规则。载入须先断开；随后仍需手动选择设备。不会保存凭据，也不会自动连接或开始记录。显示设置仍与控制台共享。"
            : "Saves parameters, encoding, line ending, paste pacing, display and log rules. Disconnect before loading, then select a device manually. Credentials are excluded; loading never connects or starts logging. Display settings are shared with console logs."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
