"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Edit2,
  Globe,
  Loader2,
  Plus,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { useUiTranslations } from "@/i18n/client";
import apiClient from "@/lib/api";
import { errorMessage } from "@/lib/errors";

export interface Preset {
  id: string;
  name: string;
  command: string;
  group_name: string;
  device_type: string;
  is_public: boolean;
  is_danger: boolean;
  owner_id: string | null;
}

interface Props {
  deviceType: "adb" | "serial";
  onRun: (cmd: string) => void;
  disabled?: boolean;
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm \
focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors";

// ── 分组折叠组件 ──────────────────────────────────────────────
function Group({
  title,
  items,
  icon,
  onRun,
  onEdit,
  onDelete,
  disabled,
}: {
  title: string;
  items: Preset[];
  icon: React.ReactNode;
  onRun: (cmd: string) => void;
  onEdit: (p: Preset) => void;
  onDelete: (p: Preset) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground bg-muted/30 hover:bg-muted/50 flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {icon}
        <span className="flex-1 text-left">{title}</span>
        <span className="text-muted-foreground/60">{items.length}</span>
      </button>
      {open && (
        <div>
          {items.map((p) => (
            <div
              key={p.id}
              className="group hover:bg-muted/30 flex items-center gap-1 px-2 py-1 transition-colors"
            >
              <button
                onClick={() => onRun(p.command)}
                disabled={disabled}
                title={p.command}
                className={`flex-1 truncate rounded px-1 py-1 text-left text-xs transition-colors disabled:opacity-40 ${
                  p.is_danger
                    ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    : "hover:text-primary"
                }`}
              >
                {p.is_danger && (
                  <AlertTriangle size={10} className="mr-1 mb-0.5 inline" />
                )}
                {p.name}
              </button>
              <div className="hidden items-center gap-1 group-hover:flex">
                <button
                  onClick={() => onEdit(p)}
                  className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  onClick={() => onDelete(p)}
                  className="text-muted-foreground p-0.5 transition-colors hover:text-red-500"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
export default function PresetPanel({
  deviceType,
  onRun,
  disabled = false,
}: Props) {
  const t = useUiTranslations();

  const { data: session } = useSession();
  const isDev = session?.user?.role === "developer";
  const userId = session?.user?.id;

  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [publicOpen, setPublicOpen] = useState(true);
  const [myOpen, setMyOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get("/api/v1/debug/commands", {
        params: { device_type: deviceType },
      });
      setPresets(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [deviceType]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(p: Preset) {
    const label = p.is_public
      ? t("ui.publicCommands")
      : t("ui.personalCommands");
    if (!confirm(t("dynamic.deletemessage62", { p0: label, p1: p.name })))
      return;
    try {
      await apiClient.delete(`/api/v1/debug/commands/${p.id}`);
      load();
    } catch (e: unknown) {
      alert(errorMessage(e, t("ui.deleteFailed")));
    }
  }

  // 按公共/个人分组
  const publicPresets = presets.filter((p) => p.is_public);
  const myPresets = presets.filter(
    (p) => !p.is_public && p.owner_id === userId,
  );

  // 公共命令按 group_name 分组
  const publicGroups = Array.from(
    new Set(publicPresets.map((p) => p.group_name)),
  ).map((g) => ({
    group: g,
    items: publicPresets.filter((p) => p.group_name === g),
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="border-border flex flex-shrink-0 items-center justify-between border-b px-3 py-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t("ui.presetCommands")}
        </p>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
          title={t("ui.newCommand")}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 命令列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-muted-foreground flex justify-center py-6">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* 公共命令区域 */}
            <div>
              <button
                onClick={() => setPublicOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 bg-blue-50/50 px-3 py-2 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 dark:bg-blue-950/20 dark:text-blue-400 dark:hover:bg-blue-950/30"
              >
                {publicOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <Globe size={11} />
                <span className="flex-1 text-left">
                  {t("ui.publicCommands")}
                </span>
                <span>{publicPresets.length}</span>
              </button>
              {publicOpen && (
                <div className="divide-border/30 divide-y">
                  {publicGroups.map(({ group, items }) => (
                    <Group
                      key={group}
                      title={group}
                      items={items}
                      icon={null}
                      onRun={onRun}
                      onEdit={(p) => {
                        setEditing(p);
                        setShowForm(true);
                      }}
                      onDelete={handleDelete}
                      disabled={disabled}
                    />
                  ))}
                  {publicPresets.length === 0 && (
                    <p className="text-muted-foreground px-4 py-3 text-xs">
                      {t("ui.noPublicCommands")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 个人命令区域 */}
            <div className="mt-1">
              <button
                onClick={() => setMyOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 bg-violet-50/50 px-3 py-2 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 dark:hover:bg-violet-950/30"
              >
                {myOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <UserIcon size={11} />
                <span className="flex-1 text-left">
                  {t("ui.personalCommands")}
                </span>
                <span>{myPresets.length}</span>
              </button>
              {myOpen && (
                <div>
                  {myPresets.length === 0 ? (
                    <div className="text-muted-foreground space-y-1 px-4 py-3 text-xs">
                      <p>{t("ui.noPersonalCommands")}</p>
                      <button
                        onClick={() => {
                          setEditing(null);
                          setShowForm(true);
                        }}
                        className="text-primary hover:underline"
                      >
                        {t("ui.newPersonalCommand")}
                      </button>
                    </div>
                  ) : (
                    myPresets.map((p) => (
                      <div
                        key={p.id}
                        className="group hover:bg-muted/30 flex items-center gap-1 px-2 py-1 transition-colors"
                      >
                        <button
                          onClick={() => onRun(p.command)}
                          disabled={disabled}
                          title={p.command}
                          className={`flex-1 truncate rounded px-1 py-1 text-left text-xs transition-colors disabled:opacity-40 ${
                            p.is_danger
                              ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                              : "hover:text-primary"
                          }`}
                        >
                          {p.is_danger && (
                            <AlertTriangle
                              size={10}
                              className="mr-1 mb-0.5 inline"
                            />
                          )}
                          {p.name}
                        </button>
                        <div className="hidden items-center gap-1 group-hover:flex">
                          <button
                            onClick={() => {
                              setEditing(p);
                              setShowForm(true);
                            }}
                            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="text-muted-foreground p-0.5 transition-colors hover:text-red-500"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <PresetFormModal
          preset={editing}
          deviceType={deviceType}
          isDev={isDev}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ── 新建/编辑弹窗 ─────────────────────────────────────────────
function PresetFormModal({
  preset,
  deviceType,
  isDev,
  onClose,
  onSuccess,
}: {
  preset: Preset | null;
  deviceType: string;
  isDev: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useUiTranslations();

  const [name, setName] = useState(preset?.name ?? "");
  const [command, setCommand] = useState(preset?.command ?? "");
  const [group, setGroup] = useState(preset?.group_name ?? "General");
  const [isPublic, setIsPublic] = useState(preset?.is_public ?? false);
  const [isDanger, setIsDanger] = useState(preset?.is_danger ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!name.trim() || !command.trim()) {
      setError(t("ui.nameAndCommandAreRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (preset) {
        await apiClient.patch(`/api/v1/debug/commands/${preset.id}`, {
          name: name.trim(),
          command,
          group_name: group.trim(),
          is_danger: isDanger,
        });
      } else {
        await apiClient.post("/api/v1/debug/commands", {
          name: name.trim(),
          command,
          group_name: group.trim(),
          device_type: deviceType,
          is_public: isPublic,
          is_danger: isDanger,
        });
      }
      onSuccess();
    } catch (e: unknown) {
      setError(errorMessage(e, t("ui.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-end">
      <div className="bg-background border-border pointer-events-auto m-3 w-80 overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">
            {preset ? t("ui.editCommand") : t("ui.newCommand")}
          </h3>
          <button onClick={onClose}>
            <X size={15} className="text-muted-foreground" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium">
              {t("ui.name")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder={t("ui.commandName")}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              {t("ui.command")}
            </label>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={3}
              className={`${inputCls} resize-none font-mono`}
              placeholder={
                deviceType === "serial"
                  ? t("ui.eGHelpRN")
                  : t("ui.eGGetpropRoProductModel")
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              {t("ui.group")}
            </label>
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className={inputCls}
              placeholder={t("ui.eGDeviceInformation")}
            />
          </div>
          <div className="flex flex-col gap-2">
            {isDev && !preset?.is_public && !preset && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="accent-primary"
                />
                <Globe size={11} className="text-blue-500" />{" "}
                {t("ui.publicCommandVisibleToAllUsers")}
              </label>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isDanger}
                onChange={(e) => setIsDanger(e.target.checked)}
                className="accent-red-500"
              />
              <AlertTriangle size={11} className="text-red-500" />{" "}
              {t("ui.dangerousCommandHighlightedInRed")}
            </label>
          </div>
          {error && (
            <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-500 dark:bg-red-950/30">
              {error}
            </p>
          )}
        </div>
        <div className="border-border flex justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onClose}
            className="border-border hover:bg-muted/50 rounded-lg border px-3 py-1.5 text-xs"
          >
            {t("ui.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            {preset ? t("ui.save") : t("ui.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
