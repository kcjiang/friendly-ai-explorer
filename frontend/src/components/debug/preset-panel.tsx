"use client";
import { useUiTranslations } from "@/i18n/client";

import { errorMessage } from "@/lib/errors";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  X,
  Globe,
  User as UserIcon,
  AlertTriangle,
} from "lucide-react";
import apiClient from "@/lib/api";

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
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
                   text-muted-foreground bg-muted/30 hover:bg-muted/50 transition-colors"
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
              className="group flex items-center gap-1 px-2 py-1 hover:bg-muted/30 transition-colors"
            >
              <button
                onClick={() => onRun(p.command)}
                disabled={disabled}
                title={p.command}
                className={`flex-1 text-left text-xs py-1 px-1 truncate rounded
                            disabled:opacity-40 transition-colors ${
                              p.is_danger
                                ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                : "hover:text-primary"
                            }`}
              >
                {p.is_danger && (
                  <AlertTriangle size={10} className="inline mr-1 mb-0.5" />
                )}
                {p.name}
              </button>
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  onClick={() => onEdit(p)}
                  className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  onClick={() => onDelete(p)}
                  className="p-0.5 text-muted-foreground hover:text-red-500 transition-colors"
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

  async function load() {
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
  }

  useEffect(() => {
    load();
  }, [deviceType]);

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
    <div className="flex flex-col h-full overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t("ui.presetCommands")}
        </p>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title={t("ui.newCommand")}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 命令列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* 公共命令区域 */}
            <div>
              <button
                onClick={() => setPublicOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold
                           text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20
                           hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
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
                <div className="divide-y divide-border/30">
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
                    <p className="text-xs text-muted-foreground px-4 py-3">
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
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold
                           text-violet-600 dark:text-violet-400 bg-violet-50/50 dark:bg-violet-950/20
                           hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
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
                    <div className="px-4 py-3 text-xs text-muted-foreground space-y-1">
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
                        className="group flex items-center gap-1 px-2 py-1 hover:bg-muted/30 transition-colors"
                      >
                        <button
                          onClick={() => onRun(p.command)}
                          disabled={disabled}
                          title={p.command}
                          className={`flex-1 text-left text-xs py-1 px-1 truncate rounded
                                      disabled:opacity-40 transition-colors ${
                                        p.is_danger
                                          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                          : "hover:text-primary"
                                      }`}
                        >
                          {p.is_danger && (
                            <AlertTriangle
                              size={10}
                              className="inline mr-1 mb-0.5"
                            />
                          )}
                          {p.name}
                        </button>
                        <div className="hidden group-hover:flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditing(p);
                              setShowForm(true);
                            }}
                            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="p-0.5 text-muted-foreground hover:text-red-500 transition-colors"
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
    <div className="fixed inset-0 z-50 flex items-end justify-end pointer-events-none">
      <div
        className="pointer-events-auto w-80 bg-background border border-border rounded-xl
                      shadow-2xl m-3 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">
            {preset ? t("ui.editCommand") : t("ui.newCommand")}
          </h3>
          <button onClick={onClose}>
            <X size={15} className="text-muted-foreground" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">
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
            <label className="block text-xs font-medium mb-1">
              {t("ui.command")}
            </label>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={3}
              className={`${inputCls} font-mono resize-none`}
              placeholder={
                deviceType === "serial"
                  ? t("ui.eGHelpRN")
                  : t("ui.eGGetpropRoProductModel")
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
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
              <label className="flex items-center gap-2 text-xs cursor-pointer">
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
            <label className="flex items-center gap-2 text-xs cursor-pointer">
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
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 rounded">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted/50"
          >
            {t("ui.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground
                       rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 size={11} className="animate-spin" />}
            {preset ? t("ui.save") : t("ui.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
