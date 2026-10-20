"use client";

import { Plus, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { type Option } from "@/types/catalog";
import { CatalogCombobox, ConfirmDialog } from "./catalog-ui";

export function ManagedSelect({
  category,
  label,
  value,
  onChange,
  disabled,
  required,
  placeholder,
  ...control
}: {
  category:
    | "customer_level"
    | "product_type"
    | "project_pm"
    | "project_stage"
    | "contact_method";
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const { data: session } = useSession();
  const developer = session?.user.role === "developer";
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Option | null>(null);
  const pendingDelete = useRef<Option | null>(null);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api
      .get(`/api/v1/catalog/options/${category}`, { signal: controller.signal })
      .then(({ data }) => setOptions(data))
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(errorMessage(err, "选项加载失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category]);
  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/api/v1/catalog/options/${category}`, {
        value: name.trim(),
      });
      setOptions((current) =>
        [...current, data].sort((a, b) => a.label.localeCompare(b.label)),
      );
      onChange(data.value);
      setName("");
      setAdding(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      await api.delete(`/api/v1/catalog/options/${category}`, {
        params: { value: deleting.value },
      });
      setOptions((current) =>
        current.filter((option) => option.value !== deleting.value),
      );
      if (value === deleting.value) onChange("");
      setDeleting(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <CatalogCombobox
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen && pendingDelete.current) {
            setDeleting(pendingDelete.current);
            pendingDelete.current = null;
          }
        }}
        {...control}
        label={label}
        value={value ? [value] : []}
        options={options}
        onChange={(next) => onChange(next[0] ?? "")}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        popup
        searchable={false}
        loading={loading}
        optionAction={
          developer && !disabled
            ? (option) => (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`删除${label}选项 ${option.label}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    setDeleteError("");
                    pendingDelete.current = option;
                  }}
                >
                  <Trash2 />
                </Button>
              )
            : undefined
        }
        footer={
          <>
            {error && (
              <p role="alert" className="text-destructive px-2 py-1 text-sm">
                {error}
              </p>
            )}
            {developer && !disabled && (
              <div className="border-t p-1">
                {adding ? (
                  <div className="space-y-2 p-1">
                    <Input
                      aria-label={`新增${label}选项名称`}
                      placeholder="输入选项名称"
                      maxLength={100}
                      value={name}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          void add();
                        }
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setAdding(false)}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !name.trim()}
                        onClick={() => void add()}
                      >
                        添加
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={busy || loading}
                    onClick={() => setAdding(true)}
                  >
                    <Plus />
                    新增选项
                  </Button>
                )}
              </div>
            )}
          </>
        }
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`删除${label}选项？`}
        description={`将删除「${deleting?.label ?? ""}」。仍被记录使用的选项（包括最近删除中的记录）无法删除。`}
        destructive
        busy={busy}
        error={deleteError}
        confirmLabel="删除选项"
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
