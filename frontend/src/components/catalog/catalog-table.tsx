"use client";
import { getBrowserUiLocale } from "@/i18n/browser";

import { useUiTranslations, translateLabels } from "@/i18n/client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  createColumnHelper,
  useTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/base/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/base/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/base/table";
import { type CatalogRecord, type Kind } from "@/types/catalog";
import { Identification } from "./catalog-ui";
import {
  type CatalogTableFeatures,
  catalogTableFeatures,
} from "./data-table-features";

export const catalogColumns: Record<
  Kind,
  { key: keyof CatalogRecord; label: string; fixed?: boolean }[]
> = {
  customers: [
    { key: "company_name", label: "Customer company", fixed: true },
    { key: "country_name", label: "Country" },
    { key: "level", label: "Customer tier" },
    { key: "business", label: "Business" },
    { key: "updated_at", label: "Updated" },
  ],
  products: [
    { key: "model", label: "Product model", fixed: true },
    { key: "type", label: "Type" },
    { key: "chipset", label: "Chipset" },
    { key: "system", label: "System" },
    { key: "updated_at", label: "Updated" },
  ],
  projects: [
    { key: "number", label: "Project number", fixed: true },
    { key: "pm", label: "Project manager" },
    { key: "fae_name", label: "FAE" },
    { key: "start_date", label: "Start date" },
    { key: "stage", label: "Project stage" },
    { key: "updated_at", label: "Updated" },
  ],
};
const columnHelper = createColumnHelper<CatalogTableFeatures, CatalogRecord>();

type CatalogTableOptions = {
  kind: Kind;
  records: CatalogRecord[];
  total: number;
  pagination: PaginationState;
  sorting: SortingState;
  visibility: ColumnVisibilityState;
  query: string;
  onQueryChange: OnChangeFn<string>;
  selectionScope: string;
  disabled: boolean;
  trash: boolean;
  onPaginationChange: OnChangeFn<PaginationState>;
  onSortingChange: OnChangeFn<SortingState>;
  onVisibilityChange: OnChangeFn<ColumnVisibilityState>;
  onOpen: (record: CatalogRecord) => void;
  onEdit: (record: CatalogRecord) => void;
  onCopy: (record: CatalogRecord) => void;
  onDelete: (record: CatalogRecord) => void;
  onRestore: (record: CatalogRecord) => void;
};

export function useCatalogTable(options: CatalogTableOptions) {
  const t = useUiTranslations();

  const {
    kind,
    records,
    total,
    pagination,
    sorting,
    visibility,
    selectionScope,
    disabled,
    trash,
  } = options;
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });
  const [selection, setSelection] = useState<{
    scope: string;
    value: RowSelectionState;
  }>({ scope: selectionScope, value: {} });
  useEffect(() => {
    setSelection({ scope: selectionScope, value: {} });
  }, [selectionScope]);
  const rowSelection =
    selection.scope === selectionScope ? selection.value : {};
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: "select",
          header: ({ table }) => (
            <Checkbox
              aria-label={t("ui.selectAllRecordsOnThisPage")}
              disabled={disabled || !records.length}
              checked={table.getIsAllPageRowsSelected()}
              indeterminate={
                table.getIsSomePageRowsSelected() &&
                !table.getIsAllPageRowsSelected()
              }
              onCheckedChange={(checked) =>
                table.toggleAllPageRowsSelected(checked)
              }
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              aria-label={t("dynamic.select", {
                p0: row.original.display_name,
              })}
              disabled={disabled}
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(checked)}
            />
          ),
          enableSorting: false,
          enableHiding: false,
        }),
        ...translateLabels(catalogColumns, t)[kind].map((definition) =>
          columnHelper.accessor(definition.key, {
            id: definition.key,
            enableHiding: !definition.fixed,
            header: ({ column }) => (
              <Button
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                {definition.label}
                {column.getIsSorted() === "asc" ? (
                  <ArrowUp />
                ) : column.getIsSorted() === "desc" ? (
                  <ArrowDown />
                ) : (
                  <ArrowUpDown />
                )}
              </Button>
            ),
            cell: ({ row }) => {
              const record = row.original;
              const value = record[definition.key];
              if (definition.key === "country_name" && record.country_code) {
                return (
                  new Intl.DisplayNames([getBrowserUiLocale()], {
                    type: "region",
                  }).of(record.country_code) ?? String(value ?? "—")
                );
              }
              if (definition.fixed)
                return (
                  <Identification name={record.display_name}>
                    <button
                      type="button"
                      disabled={disabled}
                      className="focus-visible:ring-ring/50 max-w-lg truncate text-left font-medium outline-none focus-visible:ring-3"
                      onClick={(event) => {
                        event.stopPropagation();
                        handlers.current.onOpen(record);
                      }}
                    >
                      {String(value ?? "—")}
                    </button>
                  </Identification>
                );
              if (definition.key === "updated_at")
                return (
                  <span className="text-muted-foreground">
                    {new Date(record.updated_at).toLocaleString(
                      getBrowserUiLocale(),
                    )}
                  </span>
                );
              return Array.isArray(value)
                ? value.join("、") || "—"
                : String(value ?? "—");
            },
          }),
        ),
        columnHelper.display({
          id: "actions",
          enableHiding: false,
          enableSorting: false,
          header: () => (
            <span className="sr-only">{t("ui.recordActions")}</span>
          ),
          cell: ({ row }) => (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled}
                    aria-label={t("dynamic.actionsFor", {
                      p0: row.original.display_name,
                    })}
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {trash ? (
                  <DropdownMenuItem
                    onClick={() => handlers.current.onRestore(row.original)}
                  >
                    <RotateCcw />
                    {t("ui.restore")}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem
                      onClick={() => handlers.current.onEdit(row.original)}
                    >
                      <Pencil />
                      {t("ui.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handlers.current.onCopy(row.original)}
                    >
                      <Copy />
                      {t("ui.copy")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handlers.current.onDelete(row.original)}
                    >
                      <Trash2 />
                      {t("ui.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [kind, records.length, disabled, trash, t],
  );
  return useTable({
    features: catalogTableFeatures,
    data: records,
    columns,
    getRowId: (record) => record.id,
    rowCount: total,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    autoResetPageIndex: false,
    enableSortingRemoval: false,
    onSortingChange: options.onSortingChange,
    onPaginationChange: options.onPaginationChange,
    onColumnVisibilityChange: options.onVisibilityChange,
    onGlobalFilterChange: options.onQueryChange,
    onRowSelectionChange: (updater) =>
      setSelection({
        scope: selectionScope,
        value: typeof updater === "function" ? updater(rowSelection) : updater,
      }),
    state: {
      sorting,
      pagination,
      columnVisibility: visibility,
      rowSelection,
      globalFilter: options.query,
    },
  });
}
export type CatalogTableInstance = ReturnType<typeof useCatalogTable>;

export function ColumnPicker({ table }: { table: CatalogTableInstance }) {
  const t = useUiTranslations();
  const uiLabels_catalogColumns = translateLabels(catalogColumns, t);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {t("ui.additionalColumns")}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {table
          .getAllLeafColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              closeOnClick={false}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {Object.values(uiLabels_catalogColumns)
                .flat()
                .find((definition) => definition.key === column.id)?.label ??
                column.id}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CatalogTable({
  table,
  loading,
  error,
  onOpen,
}: {
  table: CatalogTableInstance;
  loading: boolean;
  error: boolean;
  onOpen: (record: CatalogRecord) => void;
}) {
  const t = useUiTranslations();

  return (
    <div aria-busy={loading} className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={
                    header.column.id === "select"
                      ? "w-8"
                      : header.column.id === "actions"
                        ? "w-10"
                        : undefined
                  }
                  aria-sort={
                    header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : undefined
                  }
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => onOpen(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    onClick={
                      cell.column.id === "select" ||
                      cell.column.id === "actions"
                        ? (event) => event.stopPropagation()
                        : undefined
                    }
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length}
                className="text-muted-foreground h-24 text-center"
              >
                {loading
                  ? t("ui.loading2")
                  : error
                    ? t("ui.dataUnavailableRefreshAndTryAgain")
                    : t("ui.noRecords")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function CatalogPagination({
  table,
  disabled,
}: {
  table: CatalogTableInstance;
  disabled: boolean;
}) {
  const t = useUiTranslations();

  const page = table.state.pagination.pageIndex + 1;
  const count = Math.max(1, table.getPageCount());
  const pages = Array.from(
    new Set([
      1,
      ...[page - 1, page, page + 1].filter((p) => p > 1 && p < count),
      count,
    ]),
  );
  return (
    <div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        {Object.values(table.state.rowSelection).filter(Boolean).length}{" "}
        {t("ui.additionalof")} {table.getRowCount()}{" "}
        {t("ui.additionalrowsselected")}
      </span>
      <Pagination aria-label={t("ui.pagination")} className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              text={t("ui.previous")}
              aria-label={t("ui.previous")}
              href={`?page=${page - 1}`}
              aria-disabled={disabled || !table.getCanPreviousPage()}
              className={
                disabled || !table.getCanPreviousPage()
                  ? "pointer-events-none opacity-50"
                  : undefined
              }
              onClick={(event) => {
                event.preventDefault();
                if (!disabled) table.previousPage();
              }}
            />
          </PaginationItem>
          {pages.map((p, index) => (
            <PaginationItem key={p} className="flex items-center gap-0.5">
              {index > 0 && p - pages[index - 1] > 1 && <PaginationEllipsis />}
              <PaginationLink
                href={`?page=${p}`}
                aria-label={t("dynamic.page", { p0: p })}
                isActive={page === p}
                aria-disabled={disabled}
                onClick={(event) => {
                  event.preventDefault();
                  if (!disabled) table.setPageIndex(p - 1);
                }}
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext
              text={t("ui.next")}
              aria-label={t("ui.next")}
              href={`?page=${page + 1}`}
              aria-disabled={disabled || !table.getCanNextPage()}
              className={
                disabled || !table.getCanNextPage()
                  ? "pointer-events-none opacity-50"
                  : undefined
              }
              onClick={(event) => {
                event.preventDefault();
                if (!disabled) table.nextPage();
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
