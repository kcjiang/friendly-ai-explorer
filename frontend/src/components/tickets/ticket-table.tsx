"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import {
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  createColumnHelper,
  useTable,
} from "@tanstack/react-table";
import {
  type CatalogTableFeatures,
  catalogTableFeatures,
} from "@/components/catalog/data-table-features";
import { Button } from "@/components/ui/base/button";
import { Checkbox } from "@/components/ui/base/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  TICKET_PRIORITY_CONFIG,
  TICKET_STATUS_CONFIG,
  type Ticket,
} from "@/types/ticket";

const definitions = [
  { key: "system_seq", label: "工单 / 标题", fixed: true },
  { key: "title", label: "标题" },
  { key: "project_summary", label: "项目" },
  { key: "assignee", label: "分配给" },
  { key: "priority", label: "重要性" },
  { key: "description", label: "简要问题描述" },
  { key: "status", label: "状态" },
  { key: "next_plan", label: "下一步计划" },
  { key: "updated_at", label: "更新时间" },
  { key: "created_at", label: "创建时间" },
] satisfies { key: keyof Ticket; label: string; fixed?: boolean }[];
const columnHelper = createColumnHelper<CatalogTableFeatures, Ticket>();
type TicketTableOptions = {
  records: Ticket[];
  total: number;
  pagination: PaginationState;
  sorting: SortingState;
  visibility: ColumnVisibilityState;
  selection: RowSelectionState;
  disabled: boolean;
  onPaginationChange: OnChangeFn<PaginationState>;
  onSortingChange: OnChangeFn<SortingState>;
  onVisibilityChange: OnChangeFn<ColumnVisibilityState>;
  onSelectionChange: OnChangeFn<RowSelectionState>;
  onOpen: (ticket: Ticket, edit?: boolean) => void;
  onCopy: (ticket: Ticket) => void;
};
export function useTicketTable(options: TicketTableOptions) {
  const {
    records,
    total,
    pagination,
    sorting,
    visibility,
    selection,
    disabled,
  } = options;
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: "select",
          enableHiding: false,
          enableSorting: false,
          header: ({ table }) => (
            <Checkbox
              aria-label="选择本页全部工单"
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
              aria-label={`选择 ${row.original.ticket_no}`}
              disabled={disabled}
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(checked)}
            />
          ),
        }),
        ...definitions.map((definition) =>
          columnHelper.accessor(definition.key, {
            id: definition.key,
            enableHiding: definition.key !== "system_seq",
            enableSorting: [
              "system_seq",
              "title",
              "priority",
              "status",
              "updated_at",
              "created_at",
            ].includes(definition.key),
            header: ({ column }) =>
              column.getCanSort() ? (
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
              ) : (
                definition.label
              ),
            cell: ({ row }) => {
              const ticket = row.original;
              const key = definition.key;
              if (key === "system_seq")
                return (
                  <button
                    type="button"
                    disabled={disabled}
                    className="focus-visible:ring-ring/50 block max-w-72 rounded-sm text-left outline-none focus-visible:ring-3"
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.current.onOpen(ticket);
                    }}
                  >
                    <span
                      className="block truncate font-medium"
                      title={ticket.display_name}
                    >
                      {ticket.display_name}
                    </span>
                    <span
                      className="text-muted-foreground block truncate"
                      title={ticket.title}
                    >
                      {ticket.title}
                    </span>
                  </button>
                );
              if (key === "assignee")
                return (
                  <span title={ticket.assignee?.email}>
                    {ticket.assignee?.name ?? "未分配"}
                  </span>
                );
              if (key === "priority")
                return (
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${TICKET_PRIORITY_CONFIG[ticket.priority].color}`}
                  >
                    {TICKET_PRIORITY_CONFIG[ticket.priority].label}
                  </span>
                );
              if (key === "status")
                return (
                  <div>
                    <span
                      className={TICKET_STATUS_CONFIG[ticket.status].textColor}
                    >
                      {TICKET_STATUS_CONFIG[ticket.status].label}
                    </span>
                    {ticket.status_note && (
                      <p
                        className="text-muted-foreground max-w-40 truncate text-xs"
                        title={ticket.status_note}
                      >
                        {ticket.status_note}
                      </p>
                    )}
                  </div>
                );
              if (key === "updated_at" || key === "created_at")
                return (
                  <span className="text-muted-foreground">
                    {new Date(ticket[key]).toLocaleString("zh-CN")}
                  </span>
                );
              return (
                <p
                  className="text-muted-foreground max-w-64 truncate"
                  title={String(ticket[key] ?? "")}
                >
                  {String(ticket[key] || "—")}
                </p>
              );
            },
          }),
        ),
        columnHelper.display({
          id: "actions",
          enableHiding: false,
          enableSorting: false,
          header: () => <span className="sr-only">工单操作</span>,
          cell: ({ row }) => (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled}
                    aria-label={`操作 ${row.original.ticket_no}`}
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handlers.current.onOpen(row.original)}
                >
                  <Eye />
                  查看详情
                </DropdownMenuItem>
                {row.original.can_edit && (
                  <DropdownMenuItem
                    onClick={() => handlers.current.onOpen(row.original, true)}
                  >
                    <Pencil />
                    编辑
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => handlers.current.onCopy(row.original)}
                >
                  <Copy />
                  复制工单编号
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [disabled, records.length],
  );
  return useTable({
    features: catalogTableFeatures,
    data: records,
    columns,
    getRowId: (ticket) => ticket.id,
    rowCount: total,
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    autoResetPageIndex: false,
    enableSortingRemoval: false,
    onSortingChange: options.onSortingChange,
    onPaginationChange: options.onPaginationChange,
    onColumnVisibilityChange: options.onVisibilityChange,
    onRowSelectionChange: options.onSelectionChange,
    state: {
      sorting,
      pagination,
      columnVisibility: visibility,
      rowSelection: selection,
    },
  });
}
export type TicketTableInstance = ReturnType<typeof useTicketTable>;

export function TicketColumns({ table }: { table: TicketTableInstance }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Columns
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
              {definitions.find((definition) => definition.key === column.id)
                ?.label ?? column.id}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const columnWidths: Record<string, number> = {
  select: 40,
  system_seq: 280,
  title: 220,
  project_summary: 180,
  assignee: 160,
  priority: 110,
  description: 220,
  status: 140,
  next_plan: 220,
  updated_at: 180,
  created_at: 180,
  actions: 40,
};

export function TicketTable({
  table,
  loading,
  error,
  onOpen,
}: {
  table: TicketTableInstance;
  loading: boolean;
  error: boolean;
  onOpen: (record: Ticket) => void;
}) {
  return (
    <div aria-busy={loading} className="overflow-hidden rounded-md border">
      <Table
        className="table-fixed"
        style={{
          minWidth: table
            .getVisibleLeafColumns()
            .reduce(
              (width, column) => width + (columnWidths[column.id] ?? 180),
              0,
            ),
        }}
      >
        <colgroup>
          {table.getVisibleLeafColumns().map((column) => (
            <col
              key={column.id}
              style={{ width: columnWidths[column.id] ?? 180 }}
            />
          ))}
        </colgroup>
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
                  ? "加载中…"
                  : error
                    ? "数据暂不可用，请刷新重试。"
                    : "暂无记录"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function TicketPagination({
  table,
  disabled,
}: {
  table: TicketTableInstance;
  disabled: boolean;
}) {
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
        {Object.values(table.state.rowSelection).filter(Boolean).length} of{" "}
        {table.getRowCount()} row(s) selected.
      </span>
      <Pagination aria-label="分页" className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              text="上一页"
              aria-label="上一页"
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
                aria-label={`第 ${p} 页`}
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
              text="下一页"
              aria-label="下一页"
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
