"use client";

import { isAxiosError } from "axios";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Textarea } from "@/components/ui/base/textarea";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useDeviceText } from "./device-tools";

type Command = {
  id: string;
  name: string;
  command: string;
  group: string;
  confirmBeforeRun: boolean;
};
type EditorState = {
  draft: Command;
  original: Command | null;
  status: "editing" | "conflict" | "compare";
  latest: Command | null;
};
function normalized(command: Command): Command {
  return {
    id: command.id,
    name: command.name.trim(),
    command: command.command,
    group: command.group.trim() || "General",
    confirmBeforeRun: command.confirmBeforeRun,
  };
}
function sameCommand(left: Command | null, right: Command | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.command === right.command &&
    left.group === right.group &&
    left.confirmBeforeRun === right.confirmBeforeRun
  );
}

type CommandProps = {
  deviceType: "adb" | "serial";
  onRun: (command: string) => void;
  disabled: boolean;
  onEditingChange?: (editing: boolean) => void;
};

export default function QuickCommands(props: CommandProps) {
  const { onEditingChange } = props;
  const d = useDeviceText();
  const { data: auth } = useSession();
  const [space, setSpace] = useState<"personal" | "public">("personal");
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    onEditingChange?.(locked);
    return () => onEditingChange?.(false);
  }, [locked, onEditingChange]);
  return (
    <div>
      <div
        className="flex gap-1 border-b p-3"
        role="group"
        aria-label={d("Command space", "命令空间")}
      >
        {(["personal", "public"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={space === value ? "secondary" : "ghost"}
            aria-pressed={space === value}
            disabled={locked}
            onClick={() => setSpace(value)}
          >
            {value === "personal"
              ? d("My space", "我的空间")
              : d("Public space", "公共空间")}
          </Button>
        ))}
      </div>
      <CommandList
        key={`${auth?.user?.id}:${space}:${props.deviceType}`}
        {...props}
        space={space}
        onLockChange={setLocked}
      />
    </div>
  );
}

function CommandList({
  deviceType,
  onRun,
  disabled,
  space,
  onLockChange,
}: CommandProps & {
  space: "personal" | "public";
  onLockChange: (locked: boolean) => void;
}) {
  const d = useDeviceText();
  const { data: auth } = useSession();
  const developer = auth?.user?.role === "developer";
  const editable = space === "personal" || developer;
  const storageKey = `fae-command-order:${auth?.user?.id || "guest"}:${deviceType}${space === "personal" ? ":personal" : ""}`;
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editing = editor?.draft || null;
  const conflict = editor?.status === "conflict";
  const comparison =
    editor?.status === "compare" ? { latest: editor.latest } : null;
  const [exists, setExists] = useState(false);
  const [filePath, setFilePath] = useState("");
  function startEditing(draft: Command, original: Command | null = null) {
    setEditor({ draft, original, status: "editing", latest: null });
    setNotice("");
    setError("");
  }
  function updateDraft(draft: Command) {
    setEditor((current) => (current ? { ...current, draft } : null));
  }
  const [revision, setRevision] = useState("missing");
  const [commands, setCommands] = useState<Command[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onLockChange(busy || !!editing);
    return () => onLockChange(false);
  }, [busy, editing, onLockChange]);
  useEffect(() => {
    if (!editing || typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing]);
  async function load(preserveDraft = false) {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get("/api/v1/debug/commands", {
        params: { device_type: deviceType, space },
      });
      const latest: Command[] = data.catalog.commands;
      if (preserveDraft && editor) {
        const updated =
          latest.find((item) => item.id === editor.draft.id) || null;
        if (updated && sameCommand(updated, normalized(editor.draft))) {
          setEditor(null);
          setNotice(
            d("Command is already saved", "命令已保存，无需重复保存。"),
          );
        } else if (!sameCommand(updated, editor.original)) {
          setEditor({ ...editor, status: "compare", latest: updated });
        } else {
          setEditor({ ...editor, status: "editing", latest: null });
          setNotice(
            d(
              "Latest list loaded. Your draft is retained; save when ready.",
              "已载入最新列表并保留草稿，可以继续保存。",
            ),
          );
        }
      }
      setCommands(latest);
      setExists(data.exists);
      setFilePath(data.path);
      setRevision(data.revision);
    } catch (error) {
      setCommands([]);
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
  }, [deviceType, space]);
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
    `${item.name} ${item.command} ${item.group}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const groups = Array.from(
    new Set(visible.map((item) => item.group || "General")),
  );
  async function persist(next: Command[]) {
    const { data } = await apiClient.put("/api/v1/debug/commands", {
      revision,
      space,
      catalog: {
        version: 1,
        transport: deviceType,
        commands: next,
      },
    });
    setCommands(next);
    setExists(true);
    setRevision(data.revision);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (
      busy ||
      loading ||
      conflict ||
      comparison ||
      !editable ||
      !editing?.name?.trim() ||
      !editing.command
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    const item = normalized(editing);
    try {
      await persist(
        commands.some((old) => old.id === item.id)
          ? commands.map((old) => (old.id === item.id ? item : old))
          : [...commands, item],
      );
      setEditor(null);
      setNotice(d("Command saved", "命令已保存"));
    } catch (error) {
      if (
        isAxiosError(error) &&
        (error.response?.status === 409 || !error.response)
      )
        setEditor((current) =>
          current ? { ...current, status: "conflict", latest: null } : null,
        );
      setError(
        errorMessage(error, d("Could not save commands", "无法保存命令")),
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Command) {
    if (
      busy ||
      loading ||
      !!editing ||
      !editable ||
      !confirm(`${d("Delete command", "删除命令")} “${item.name}”?`)
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await persist(commands.filter((old) => old.id !== item.id));
      setNotice(d("Command deleted", "命令已删除"));
    } catch (error) {
      setError(
        errorMessage(error, d("Could not delete command", "无法删除命令")),
      );
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
          disabled={loading || busy || !!editing}
          onClick={() => {
            void load();
          }}
        >
          {d("Refresh", "刷新")}
        </Button>
        {editable && (
          <Button
            disabled={
              loading || busy || !!error || !!editing || commands.length >= 1000
            }
            size="sm"
            variant="outline"
            onClick={() =>
              startEditing({
                id: crypto.randomUUID(),
                name: "",
                command: "",
                group: "General",
                confirmBeforeRun: false,
              })
            }
          >
            {d("New", "新建")}
          </Button>
        )}
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
      {notice && (
        <p role="status" className="text-muted-foreground text-xs">
          {notice}
        </p>
      )}
      <p className="text-muted-foreground text-xs break-all">{filePath}</p>
      {conflict && !comparison && editing && (
        <Button
          size="sm"
          disabled={loading || busy}
          onClick={() => void load(true)}
        >
          {d("Reload latest and keep draft", "载入最新列表并保留草稿")}
        </Button>
      )}
      {comparison && editing && (
        <div className="space-y-2 rounded border p-2 text-xs">
          <p>
            {d(
              "This command also changed. Review the latest version before choosing.",
              "此命令也已变更，请比较最新内容和下方草稿后选择。",
            )}
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
            {comparison.latest
              ? JSON.stringify(comparison.latest, null, 2)
              : d("The command was deleted.", "此命令已被删除。")}
          </pre>
          <Button
            size="xs"
            disabled={busy || loading}
            onClick={() => {
              setEditor({
                draft: comparison.latest
                  ? editing
                  : { ...editing, id: crypto.randomUUID() },
                original: comparison.latest,
                status: "editing",
                latest: null,
              });
              setError("");
            }}
          >
            {comparison.latest
              ? d("Keep my draft", "保留我的草稿")
              : d("Save draft as new command", "将草稿另存为新命令")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              if (comparison.latest)
                startEditing(comparison.latest, comparison.latest);
              else setEditor(null);
              setError("");
            }}
          >
            {d("Use latest version", "使用最新版本")}
          </Button>
        </div>
      )}
      {editing && (
        <form onSubmit={save} className="rounded-lg border p-2">
          <fieldset disabled={busy || loading} className="space-y-2">
            <Input
              required
              maxLength={200}
              aria-label={d("Name", "名称")}
              placeholder={d("Name", "名称")}
              value={editing.name || ""}
              onChange={(e) =>
                updateDraft({ ...editing, name: e.target.value })
              }
            />
            <Input
              maxLength={100}
              aria-label={d("Group", "分组")}
              placeholder={d("Group", "分组")}
              value={editing.group || ""}
              onChange={(e) =>
                updateDraft({ ...editing, group: e.target.value })
              }
            />
            <Textarea
              required
              maxLength={100000}
              aria-label={d("Command content", "命令内容")}
              placeholder={d(
                "One or more shell commands",
                "一条或多条 Shell 命令",
              )}
              className="min-h-32 font-mono text-xs"
              value={editing.command || ""}
              onChange={(e) =>
                updateDraft({ ...editing, command: e.target.value })
              }
            />
            <p className="text-muted-foreground text-xs">
              {d("Name", "名称")} {(editing.name || "").length}/200 ·{" "}
              {d("Group", "分组")} {(editing.group || "").length}/100 ·{" "}
              {d("Content", "内容")} {(editing.command || "").length}/100000
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!editing.confirmBeforeRun}
                onChange={(e) =>
                  updateDraft({
                    ...editing,
                    confirmBeforeRun: e.target.checked,
                  })
                }
              />
              {d("Confirm before running", "执行前确认")}
            </label>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={busy || loading || conflict || !!comparison}
              >
                {d("Save", "保存")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditor(null);
                  setError("");
                }}
              >
                {d("Cancel", "取消")}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {loading && (
        <p className="text-muted-foreground text-xs">
          {d("Loading…", "加载中…")}
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="text-muted-foreground text-xs">
          {!exists
            ? editable
              ? d(
                  "Default command file does not exist. Create your first command to generate it.",
                  "默认命令文件尚不存在，新建第一条命令即可生成。",
                )
              : d(
                  "Default command file does not exist. Ask an administrator to create it.",
                  "默认命令文件尚不存在，请联系管理员创建。",
                )
            : commands.length === 0
              ? d("This command file is empty", "此命令文件暂无命令")
              : d("No commands match your search", "没有匹配搜索条件的命令")}
        </p>
      )}
      {groups.map((group) => (
        <details key={group} open className="rounded-lg border">
          <summary className="bg-muted/30 cursor-pointer p-2 text-xs font-medium">
            {group}
          </summary>
          <div className="space-y-2 p-2">
            {visible
              .filter((item) => (item.group || "General") === group)
              .map((item) => (
                <div
                  key={item.id}
                  className="space-y-1 border-b pb-2 last:border-0"
                >
                  <Button
                    className="h-auto w-full justify-start text-left whitespace-normal"
                    variant="secondary"
                    disabled={disabled || loading}
                    title={item.command}
                    onClick={() => {
                      if (
                        !item.confirmBeforeRun ||
                        confirm(
                          `${d("Run command", "执行命令")} “${item.name}”?\n${item.command}`,
                        )
                      )
                        onRun(item.command);
                    }}
                  >
                    {item.confirmBeforeRun ? "⚠ " : ""}
                    {item.name}
                  </Button>
                  <pre className="text-muted-foreground max-h-24 overflow-auto text-xs break-all whitespace-pre-wrap">
                    {item.command}
                  </pre>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground mr-auto text-xs">
                      {space === "personal"
                        ? d("My space", "我的空间")
                        : d("Public space", "公共空间")}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => promote(item.id)}
                    >
                      {d("Move to top", "置顶")}
                    </Button>
                    {editable && (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy || loading || !!editing}
                          onClick={() => {
                            startEditing(item, item);
                          }}
                        >
                          {d("Edit", "编辑")}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy || loading || !!editing}
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
          "Commands come from the default JSON file in the selected space. Click Refresh to reload. Display order is saved in this browser.",
          "命令读取自当前空间指定的 JSON 文件，点击刷新重新载入。置顶顺序保存在当前浏览器。",
        )}
      </p>
    </section>
  );
}
