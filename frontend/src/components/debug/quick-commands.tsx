"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Textarea } from "@/components/ui/base/textarea";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useDeviceText } from "./device-tools";
import type { Preset } from "./preset-panel";

export default function QuickCommands({
  deviceType,
  onRun,
  disabled,
}: {
  deviceType: "adb" | "serial";
  onRun: (command: string) => void;
  disabled: boolean;
}) {
  const d = useDeviceText();
  const { data: auth } = useSession();
  const developer = auth?.user?.role === "developer";
  const storageKey = `fae-command-order:${auth?.user?.id || "guest"}:${deviceType}`;
  const [commands, setCommands] = useState<Preset[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Partial<Preset> | null>(null);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setCommands(
        (
          await apiClient.get("/api/v1/debug/commands", {
            params: { device_type: deviceType },
          })
        ).data,
      );
    } catch (error) {
      setError(
        errorMessage(error, d("Could not load commands", "无法加载快捷命令")),
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(); /* keyed by transport */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceType]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(storageKey) || "[]",
      );
      setOrder(
        Array.isArray(saved)
          ? saved.filter((value): value is string => typeof value === "string")
          : [],
      );
    } catch {
      setOrder([]);
    }
  }, [storageKey]);
  const sorted = [...commands].sort((a, b) => {
    const rank = (id: string) => {
      const index = order.indexOf(id);
      return index < 0 ? 99999 : index;
    };
    return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
  });
  const visible = sorted.filter((item) =>
    `${item.name} ${item.command} ${item.group_name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const groups = Array.from(
    new Set(visible.map((item) => item.group_name || "General")),
  );
  const editable = (item: Preset) =>
    item.is_public ? developer : item.owner_id === auth?.user?.id;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing?.name?.trim() || !editing.command?.trim()) return;
    setBusy(true);
    setError("");
    const body = {
      name: editing.name.trim(),
      command: editing.command,
      group_name: editing.group_name?.trim() || "General",
      is_danger: !!editing.is_danger,
    };
    try {
      if (editing.id)
        await apiClient.patch(`/api/v1/debug/commands/${editing.id}`, body);
      else
        await apiClient.post("/api/v1/debug/commands", {
          ...body,
          device_type: deviceType,
          is_public: !!editing.is_public,
        });
      setEditing(null);
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Preset) {
    if (!confirm(`${d("Delete command", "删除命令")} “${item.name}”?`)) return;
    setBusy(true);
    try {
      await apiClient.delete(`/api/v1/debug/commands/${item.id}`);
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  function promote(id: string) {
    const next = [id, ...order.filter((value) => value !== id)];
    setOrder(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (error) {
      setError(String(error));
    }
  }
  return (
    <section className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {d("Quick commands", "快捷命令")}
        </h2>
        <Button
          size="xs"
          variant="ghost"
          disabled={loading}
          onClick={() => {
            void load();
          }}
        >
          {d("Refresh", "刷新")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setEditing({ name: "", command: "", group_name: "General" })
          }
        >
          {d("New", "新建")}
        </Button>
      </div>
      <Input
        aria-label={d("Search commands", "搜索命令")}
        placeholder={d("Search name, content or group", "搜索名称、内容或分组")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-destructive text-xs break-words">
          {error}
        </p>
      )}
      {editing && (
        <form onSubmit={save} className="space-y-2 rounded-lg border p-2">
          <Input
            required
            aria-label={d("Name", "名称")}
            placeholder={d("Name", "名称")}
            value={editing.name || ""}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <Input
            aria-label={d("Group", "分组")}
            placeholder={d("Group", "分组")}
            value={editing.group_name || ""}
            onChange={(e) =>
              setEditing({ ...editing, group_name: e.target.value })
            }
          />
          <Textarea
            required
            aria-label={d("Command content", "命令内容")}
            placeholder={d(
              "One or more shell commands",
              "一条或多条 Shell 命令",
            )}
            className="min-h-32 font-mono text-xs"
            value={editing.command || ""}
            onChange={(e) =>
              setEditing({ ...editing, command: e.target.value })
            }
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!editing.is_danger}
              onChange={(e) =>
                setEditing({ ...editing, is_danger: e.target.checked })
              }
            />
            {d("Confirm before running", "执行前确认")}
          </label>
          {developer && !editing.id && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!editing.is_public}
                onChange={(e) =>
                  setEditing({ ...editing, is_public: e.target.checked })
                }
              />
              {d("Public command", "公共命令")}
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {d("Save", "保存")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              {d("Cancel", "取消")}
            </Button>
          </div>
        </form>
      )}
      {loading && (
        <p className="text-muted-foreground text-xs">
          {d("Loading…", "加载中…")}
        </p>
      )}
      {!loading && visible.length === 0 && (
        <p className="text-muted-foreground text-xs">
          {d("No commands found", "暂无匹配的命令")}
        </p>
      )}
      {groups.map((group) => (
        <details key={group} open className="rounded-lg border">
          <summary className="bg-muted/30 cursor-pointer p-2 text-xs font-medium">
            {group}
          </summary>
          <div className="space-y-2 p-2">
            {visible
              .filter((item) => (item.group_name || "General") === group)
              .map((item) => (
                <div
                  key={item.id}
                  className="space-y-1 border-b pb-2 last:border-0"
                >
                  <Button
                    className="h-auto w-full justify-start text-left whitespace-normal"
                    variant="secondary"
                    disabled={disabled}
                    title={item.command}
                    onClick={() => {
                      if (
                        !item.is_danger ||
                        confirm(
                          `${d("Run command", "执行命令")} “${item.name}”?\n${item.command}`,
                        )
                      )
                        onRun(item.command);
                    }}
                  >
                    {item.is_danger ? "⚠ " : ""}
                    {item.name}
                  </Button>
                  <pre className="text-muted-foreground max-h-24 overflow-auto text-xs break-all whitespace-pre-wrap">
                    {item.command}
                  </pre>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground mr-auto text-xs">
                      {item.is_public
                        ? d("Public", "公共")
                        : d("Personal", "个人")}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => promote(item.id)}
                    >
                      {d("Move to top", "置顶")}
                    </Button>
                    {editable(item) && (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setEditing(item)}
                        >
                          {d("Edit", "编辑")}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            void remove(item);
                          }}
                        >
                          {d("Delete", "删除")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </details>
      ))}
      <p className="text-muted-foreground text-xs">
        {d(
          "Commands are saved to your account. Display order is saved in this browser. .sh files run through the upload button.",
          "命令保存在账号中，置顶顺序保存在当前浏览器。.sh 文件通过上传按钮执行。",
        )}
      </p>
    </section>
  );
}
