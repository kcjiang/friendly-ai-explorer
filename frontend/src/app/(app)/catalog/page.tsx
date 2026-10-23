"use client";
import { useUiTranslations, translateLabels } from "@/i18n/client";

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
    singular: "Customer",
  },
  products: {
    icon: Package,
    singular: "Product",
  },
  projects: {
    icon: FolderKanban,
    singular: "Project",
  },
};
export default function CatalogPageView() {
  const t = useUiTranslations();
  const uiLabels_configs = translateLabels(configs, t);

  const uiLabels_labels = translateLabels(labels, t);

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
  const config = uiLabels_configs[kind];
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
            setError(errorMessage(e, t("ui.failedToLoadRecords")));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, query, sort, direction, page, trash, reload, t]);
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
        setNotice(
          t("ui.movedToRecentlyDeletedRestoreBeforePermanentlyClearing"),
        );
      } else {
        const { data: result } = await api.delete(
          `/api/v1/catalog/${target.kind}/trash`,
        );
        setNotice(
          t("dynamic.permanentlyDeletedOther", { p0: result.deleted_count }),
        );
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
      setNotice(t("ui.recordRestored"));
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
        <TopNav title={t("ui.dataManagement")} />
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
            <TabsList aria-label={t("ui.catalog")}>
              {(Object.keys(uiLabels_labels) as Kind[]).map((key) => {
                const Icon = uiLabels_configs[key].icon;
                return (
                  <TabsTrigger key={key} value={key} disabled={opening || busy}>
                    <Icon size={16} />
                    {uiLabels_labels[key]}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <div className="ml-auto max-w-80 min-w-40 flex-1">
              <InputGroup>
                <InputGroupInput
                  aria-label={t("ui.searchRecords")}
                  placeholder={
                    trash
                      ? t("dynamic.searchDeleted", { p0: config.singular })
                      : t("dynamic.search", { p0: config.singular })
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
              aria-label={t("ui.refreshRecords")}
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
              {trash ? t("ui.backToCatalog") : t("ui.recentlyDeleted")}
            </Button>
            {!trash && (
              <Button
                disabled={busy || opening}
                onClick={() => setDialog({ record: null })}
              >
                <Plus data-icon="inline-start" />
                {t("ui.new")}
                {config.singular}
              </Button>
            )}
            {trash && developer && (
              <Button
                variant="destructive"
                disabled={busy || loading || !data.total}
                onClick={() => requestDelete()}
              >
                {t("ui.clearRecentlyDeleted")}
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
                {t("ui.countryRegionData")}
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
              confirmation.record
                ? t("ui.moveToRecentlyDeleted")
                : t("ui.permanentlyClearRecentlyDeleted")
            }
            description={
              confirmation.record
                ? t(
                    "dynamic.moveToRecentlyDeletedYouCanRestoreItLaterReferenced",
                    { p0: confirmation.record.display_name },
                  )
                : t(
                    "dynamic.permanentlyDeleteAllRecentlyDeletedRecordsInIncludingRecordsHidden",
                    { p0: uiLabels_labels[confirmation.kind] },
                  )
            }
            destructive
            busy={busy}
            error={actionError}
            confirmLabel={
              confirmation.record
                ? t("ui.confirmDeletion")
                : t("ui.clearPermanently")
            }
            onCancel={() => setConfirmation(null)}
            onConfirm={() => void confirmAction()}
          />
        )}
      </div>
    </Toaster>
  );
}
