"use client";

import {
  ArrowLeft,
  Building2,
  FolderKanban,
  Package,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import type { ColumnVisibilityState } from "@tanstack/react-table";
import {
  CatalogPagination,
  CatalogTable,
  ColumnPicker,
  useCatalogTable,
} from "@/components/catalog/catalog-table";
import { ConfirmDialog } from "@/components/catalog/catalog-ui";
import { RecordDialog } from "@/components/catalog/record-dialog";
import Container from "@/components/container";
import { TopNav } from "@/components/nav";
import { Button } from "@/components/ui/base/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/base/input-group";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/base/tabs";
import { Toaster } from "@/components/ui/base/toast";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import {
  type CatalogPage,
  type CatalogRecord,
  type Kind,
  labels,
} from "@/types/catalog";

const configs = {
  customers: {
    icon: Building2,
    singular: "客户",
  },
  products: {
    icon: Package,
    singular: "产品",
  },
  projects: {
    icon: FolderKanban,
    singular: "项目",
  },
};
export default function CatalogPageView() {
  const { data: session } = useSession();
  const [kind, setKind] = useState<Kind>("customers");
  const [trash, setTrash] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated_at");
  const [direction, setDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPage>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [visibility, setVisibility] = useState<
    Record<Kind, ColumnVisibilityState>
  >({
    customers: {},
    products: {},
    projects: {},
  });
  const [dialog, setDialog] = useState<{
    record: CatalogRecord | null;
    initialDraft?: CatalogRecord;
    startEditing?: boolean;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: Kind;
    record?: CatalogRecord;
  } | null>(null);
  const [actionError, setActionError] = useState("");
  const config = configs[kind];
  const developer = session?.user.role === "developer";
  const refresh = () => {
    table.resetRowSelection();
    setReload((n) => n + 1);
  };
  const afterChange = () => {
    setPage(1);
    refresh();
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api
        .get(`/api/v1/catalog/${kind}`, {
          params: { q: query, sort, direction, page, trash, page_size: 30 },
          signal: controller.signal,
        })
        .then(({ data: result }) => {
          if (!controller.signal.aborted) {
            setData(result);
            if (page > Math.max(1, Math.ceil(result.total / 30)))
              setPage(Math.max(1, Math.ceil(result.total / 30)));
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(errorMessage(e, "资料加载失败"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, query, sort, direction, page, trash, reload]);
  async function openRecord(
    record: CatalogRecord,
    mode: "view" | "edit" | "copy" = "view",
  ) {
    if (opening || busy) return;
    setOpening(true);
    setError("");
    try {
      const { data: detail } = await api.get(
        `/api/v1/catalog/${kind}/${record.id}`,
      );
      setDialog(
        mode === "copy"
          ? { record: null, initialDraft: detail }
          : { record: detail, startEditing: mode === "edit" },
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }
  function requestDelete(record?: CatalogRecord) {
    setActionError("");
    setConfirmation({ kind, record });
  }
  async function confirmAction() {
    if (!confirmation) return;
    setBusy(true);
    setActionError("");
    const target = confirmation;
    try {
      if (target.record) {
        await api.delete(`/api/v1/catalog/${target.kind}/${target.record.id}`, {
          params: { revision: target.record.revision },
        });
        setNotice("已移至最近删除，永久清空前可恢复。");
      } else {
        const { data: result } = await api.delete(
          `/api/v1/catalog/${target.kind}/trash`,
        );
        setNotice(`已永久删除 ${result.deleted_count} 条记录。`);
      }
      setConfirmation(null);
      setDialog(null);
      afterChange();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore(record: CatalogRecord) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/v1/catalog/${kind}/${record.id}/restore`, null, {
        params: { revision: record.revision },
      });
      setNotice("记录已恢复。");
      afterChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function changeTrash() {
    setTrash(!trash);
    setSort("updated_at");
    setDirection("desc");
    setQuery("");
    setPage(1);
    setNotice("");
    setData({ items: [], total: 0 });
  }
  const table = useCatalogTable({
    kind,
    records: data.items,
    total: data.total,
    pagination: { pageIndex: page - 1, pageSize: 30 },
    sorting: [{ id: sort, desc: direction === "desc" }],
    visibility: visibility[kind],
    query,
    onQueryChange: (updater) => {
      setQuery(typeof updater === "function" ? updater(query) : updater);
      setPage(1);
    },
    selectionScope: `${kind}:${trash}:${query}`,
    disabled: busy || opening,
    trash,
    onSortingChange: (updater) => {
      const current = [{ id: sort, desc: direction === "desc" }];
      const next = typeof updater === "function" ? updater(current) : updater;
      setSort(next[0]?.id ?? "updated_at");
      setDirection(next[0]?.desc ? "desc" : "asc");
      setPage(1);
    },
    onPaginationChange: (updater) => {
      const current = { pageIndex: page - 1, pageSize: 30 };
      const next = typeof updater === "function" ? updater(current) : updater;
      setPage(next.pageIndex + 1);
    },
    onVisibilityChange: (updater) =>
      setVisibility((current) => ({
        ...current,
        [kind]:
          typeof updater === "function" ? updater(current[kind]) : updater,
      })),
    onOpen: (record) => void openRecord(record),
    onEdit: (record) => void openRecord(record, "edit"),
    onCopy: (record) => void openRecord(record, "copy"),
    onDelete: requestDelete,
    onRestore: (record) => void restore(record),
  });
  return (
    <Toaster>
      <div className="bg-background text-foreground min-h-full">
        <TopNav title="数据维护" />
        <Tabs
          value={kind}
          onValueChange={(value) => {
            setKind(value as Kind);
            setQuery("");
            setSort("updated_at");
            setDirection("desc");
            setPage(1);
            setNotice("");
            setData({ items: [], total: 0 });
          }}
        >
          <Container className="flex flex-wrap items-center gap-2 border-b py-2">
            <TabsList aria-label="资料库">
              {(Object.keys(labels) as Kind[]).map((key) => {
                const Icon = configs[key].icon;
                return (
                  <TabsTrigger key={key} value={key} disabled={opening || busy}>
                    <Icon size={16} />
                    {labels[key]}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <div className="ml-auto max-w-80 min-w-40 flex-1">
              <InputGroup>
                <InputGroupInput
                  aria-label="搜索记录"
                  placeholder={
                    trash
                      ? `搜索最近删除的${config.singular}…`
                      : `搜索${config.singular}…`
                  }
                  maxLength={200}
                  value={String(table.state.globalFilter ?? "")}
                  onChange={(e) => {
                    table.setGlobalFilter(e.target.value);
                  }}
                />
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
              </InputGroup>
            </div>
            <ColumnPicker table={table} />
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新资料"
              disabled={busy || loading}
              onClick={refresh}
            >
              <RefreshCw
                data-icon="inline-start"
                className={loading ? "animate-spin" : ""}
              />
            </Button>
            <Button
              variant={trash ? "secondary" : "outline"}
              aria-pressed={trash}
              disabled={busy || opening}
              onClick={changeTrash}
            >
              {trash ? (
                <ArrowLeft data-icon="inline-start" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              {trash ? "返回资料库" : "最近删除"}
            </Button>
            {!trash && (
              <Button
                disabled={busy || opening}
                onClick={() => setDialog({ record: null })}
              >
                <Plus data-icon="inline-start" />
                新建{config.singular}
              </Button>
            )}
            {trash && developer && (
              <Button
                variant="destructive"
                disabled={busy || loading || !data.total}
                onClick={() => requestDelete()}
              >
                清空最近删除
              </Button>
            )}
          </Container>
          <Container className="overflow-x-auto py-6">
            {notice && (
              <p role="status" className="text-muted-foreground mb-3 text-sm">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive mb-3 text-sm">
                {error}
              </p>
            )}
            <TabsContent value={kind} className="mt-0">
              <CatalogTable
                table={table}
                loading={loading}
                error={Boolean(error)}
                onOpen={(record) => void openRecord(record)}
              />
              <CatalogPagination
                table={table}
                disabled={loading || busy || opening}
              />
            </TabsContent>
            {kind === "customers" && (
              <p className="text-muted-foreground mt-5 text-xs">
                国家/地区数据：
                <a
                  href="https://www.geonames.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  GeoNames
                </a>
                （
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  CC BY 4.0
                </a>
                ）。
              </p>
            )}
          </Container>
        </Tabs>
        {dialog && (
          <RecordDialog
            kind={kind}
            record={dialog.record}
            initialDraft={dialog.initialDraft}
            startEditing={dialog.startEditing}
            onClose={() => setDialog(null)}
            onSaved={refresh}
            onDelete={requestDelete}
          />
        )}
        {confirmation && (
          <ConfirmDialog
            open
            title={
              confirmation.record ? "移至最近删除？" : "永久清空最近删除？"
            }
            description={
              confirmation.record
                ? `将「${confirmation.record.display_name}」移至最近删除，之后可以恢复。被其他记录引用的数据无法删除。`
                : `将永久删除${labels[confirmation.kind]}最近删除中的全部记录，包括当前搜索未显示的记录。此操作无法恢复。`
            }
            destructive
            busy={busy}
            error={actionError}
            confirmLabel={confirmation.record ? "确认删除" : "永久清空"}
            onCancel={() => setConfirmation(null)}
            onConfirm={() => void confirmAction()}
          />
        )}
      </div>
    </Toaster>
  );
}
