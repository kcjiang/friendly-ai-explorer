"use client";
import { useEffect, useState, useId } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import api from "@/lib/api";
import { type Option, type CatalogPage } from "@/types/catalog";

export function SearchSelect({ label, value, selectedLabel, url, kind, disabled, onChange }: { label: string; value: string; selectedLabel: string; url: string; kind?: "catalog"; disabled?: boolean; onChange: (option: Option) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      api.get(url, { params: { q: query, ...(kind ? { page_size: 50 } : {}) }, signal: controller.signal }).then(({ data }) => {
        setOptions(kind ? (data as CatalogPage).items.map((r) => ({ value: r.id, label: r.display_name })) : data);
      }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, query, url, kind]);
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery(""); }}>
    <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} disabled={disabled} className="w-full justify-between overflow-hidden font-normal"><span className="truncate">{selectedLabel || `选择${label}`}</span><ChevronsUpDown className="shrink-0 opacity-50" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(420px,calc(100vw-48px))] p-2">
      <Input aria-label={`搜索${label}`} placeholder={`搜索${label}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div id={id} role="listbox" aria-label={label} className="mt-2 max-h-56 overflow-y-auto">
        {loading ? <p role="status" className="p-3 text-sm text-muted-foreground">加载中…</p> : error ? <p role="alert" className="p-3 text-sm text-destructive">加载失败，请重新打开重试。</p> : options.length ? options.map((o) => <button key={o.value} role="option" aria-selected={value === o.value} type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none" onClick={() => { onChange(o); setOpen(false); }}><Check className={`h-4 w-4 shrink-0 ${value === o.value ? "opacity-100" : "opacity-0"}`} /><span>{o.label}{o.region ? ` · ${o.region}` : ""}</span></button>) : <p className="p-3 text-sm text-muted-foreground">没有匹配选项，请更换关键词。</p>}
      </div>
      <p className="px-2 pt-2 text-xs text-muted-foreground">输入关键词缩小范围，再从列表中选择。</p>
    </PopoverContent>
  </Popover>;
}
