"use client";

import { Plus, RefreshCw, Search, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ColumnVisibilityState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";
import {
  CatalogCombobox,
  copyCatalogText,
} from "@/components/catalog/catalog-ui";
import Container from "@/components/container";
import PageToolbar from "@/components/page-toolbar";
import TicketModal from "@/components/tickets/ticket-modal";
import { TicketSelect } from "@/components/tickets/ticket-select";
import {
  TicketColumns,
  TicketPagination,
  TicketTable,
  useTicketTable,
} from "@/components/tickets/ticket-table";
import { Button } from "@/components/ui/base/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/base/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/base/tabs";
import { Toaster, toast } from "@/components/ui/base/toast";
import { useUiTranslations } from "@/i18n/client";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { type Ticket, type UserBrief } from "@/types/ticket";

export default function TicketPage() {
  const t = useUiTranslations();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [mine, setMine] = useState(true);
  const [state, setState] = useState("open");
  const [assignee, setAssignee] = useState("");
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [usersError, setUsersError] = useState(false);
  const allTickets = !mine;
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updated_at", desc: true },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 30,
  });
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<ColumnVisibilityState>({
    created_at: false,
    title: false,
    assignee: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<{
    ticket?: Ticket;
    edit?: boolean;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
    setSelection({});
  }, [mine, query, state, assignee]);
  useEffect(() => {
    setVisibility((v) => ({ ...v, assignee: !mine }));
  }, [mine]);
  const refresh = () => setReload((n) => n + 1);
  useEffect(() => {
    if (!allTickets) return;
    const controller = new AbortController();
    setUsersError(false);
    api
      .get("/api/v1/users/", { signal: controller.signal })
      .then(({ data }) => setUsers(data))
      .catch(() => {
        if (!controller.signal.aborted) setUsersError(true);
      });
    return () => controller.abort();
  }, [allTickets, reload]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api
        .get("/api/v1/tickets/", {
          signal: controller.signal,
          params: {
            mine,
            assignee_id: allTickets && assignee ? assignee : undefined,
            q: query,
            state,
            sort: sorting[0]?.id ?? "updated_at",
            direction: sorting[0]?.desc ? "desc" : "asc",
          },
        })
        .then(({ data }) => {
          if (!controller.signal.aborted) {
            setTickets(data);
            setSelection((previous) =>
              Object.fromEntries(
                Object.entries(previous).filter(([id]) =>
                  data.some((t: Ticket) => t.id === id),
                ),
              ),
            );
            setPagination((p) => ({
              ...p,
              pageIndex: Math.min(
                p.pageIndex,
                Math.max(0, Math.ceil(data.length / p.pageSize) - 1),
              ),
            }));
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(errorMessage(e, t("ui.failedToLoadTickets")));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mine, query, state, sorting, reload, allTickets, assignee, t]);
  async function open(ticket: Ticket, edit = false) {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      const { data } = await api.get(`/api/v1/tickets/${ticket.id}`);
      setDialog({ ticket: data, edit: edit && data.can_edit });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }

  async function copy(ticket: Ticket) {
    try {
      await copyCatalogText(ticket.ticket_no);
      toast.add({ title: t("ui.copied"), type: "success" });
    } catch {
      toast.add({ title: t("ui.copyFailedTryAgain"), type: "error" });
    }
  }
  const table = useTicketTable({
    records: tickets.slice(
      pagination.pageIndex * pagination.pageSize,
      (pagination.pageIndex + 1) * pagination.pageSize,
    ),
    total: tickets.length,
    pagination,
    sorting,
    selection,
    visibility,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onSelectionChange: setSelection,
    onVisibilityChange: setVisibility,
    onOpen: open,
    onCopy: copy,
    disabled: loading || opening,
  });
  return (
    <>
      <PageToolbar label={t("ui.ticketBoard")}>
        <Tabs
          value={mine ? "mine" : "all"}
          onValueChange={(value) => setMine(value === "mine")}
        >
          <TabsList>
            <TabsTrigger value="mine">
              <UserRound />
              {t("ui.assignToMe")}
            </TabsTrigger>
            <TabsTrigger value="all">
              <Users />
              {t("ui.allTickets")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <TicketSelect
          label={t("ui.ticketOpenClosedStatus")}
          value={state}
          onValueChange={setState}
          className="w-24"
          options={[
            { value: "all", label: t("ui.allStatuses") },
            { value: "open", label: t("ui.open") },
            { value: "closed", label: t("ui.closed") },
          ]}
        />
        {allTickets && (
          <div className="w-52">
            <CatalogCombobox
              label={t("ui.assignee")}
              placeholder={t("ui.allAssignees")}
              value={assignee ? [assignee] : []}
              options={users.map((u) => ({
                value: u.id,
                label: `${u.name} (${u.email})`,
              }))}
              onChange={(values) => setAssignee(values[0] ?? "")}
              popup
              clearable
            />
          </div>
        )}
        <div className="min-w-40 flex-1 sm:ml-auto sm:max-w-80">
          <InputGroup>
            <InputGroupInput
              aria-label={t("ui.searchTickets")}
              placeholder={t("ui.searchTicketsProjectsStatuses")}
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <TicketColumns table={table} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("ui.refreshTickets")}
          disabled={loading || opening}
          onClick={refresh}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
        <Button disabled={opening} onClick={() => setDialog({})}>
          <Plus />
          {t("ui.newTicket")}
        </Button>
      </PageToolbar>
      <Container className="py-4">
        {allTickets && usersError && (
          <p role="alert" className="text-destructive mb-3 text-sm">
            {t("ui.failedToLoadAccountsRefreshAndTryAgain")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive mb-3 text-sm">
            {error}
          </p>
        )}
        <span className="sr-only" role="status">
          {loading ? t("ui.loadingTickets") : t("ui.ticketsLoaded")}
        </span>
        <TicketTable
          table={table}
          loading={loading}
          error={Boolean(error)}
          onOpen={(ticket) => {
            if (!loading && !opening) void open(ticket);
          }}
        />
        <TicketPagination table={table} disabled={loading || opening} />
      </Container>
      {dialog && (
        <TicketModal
          ticket={dialog.ticket}
          startEditing={dialog.edit}
          onClose={() => setDialog(null)}
          onSuccess={refresh}
        />
      )}
      <Toaster />
    </>
  );
}
