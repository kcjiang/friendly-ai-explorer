"use client";

import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LayoutGrid,
  List,
  LockKeyhole,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import Container from "@/components/container";
import TicketModal from "@/components/kanban/ticket-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageToolbar, SortMenu } from "@/components/ui/page-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import api from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import {
  TICKET_PRIORITY_CONFIG,
  TICKET_STATUS_CONFIG,
  type Ticket,
  TicketStatus,
  type UserBrief,
} from "@/types/ticket";

export default function TicketPage() {
  const { data: session } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [view, setView] = useState<"board" | "list">("board");
  const preferenceKey = session?.user.id
    ? `fae:ticket-view:${session.user.id}`
    : null;
  useEffect(() => {
    if (!preferenceKey) return;
    try {
      setView(
        localStorage.getItem(preferenceKey) === "list" ? "list" : "board",
      );
    } catch {
      setView("board");
    }
  }, [preferenceKey]);
  function changeView(next: "board" | "list") {
    setView(next);
    if (preferenceKey) {
      try {
        localStorage.setItem(preferenceKey, next);
      } catch {
        /* Storage may be disabled. */
      }
    }
  }
  const [mine, setMine] = useState(true);
  const [state, setState] = useState("open");
  const [assignee, setAssignee] = useState("");
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [usersError, setUsersError] = useState(false);
  const allTickets = view === "list" && !mine;
  const [query, setQuery] = useState("");
  const [showDates, setShowDates] = useState(false);
  const [draftDates, setDraftDates] = useState({ from: "", to: "" });
  const [dates, setDates] = useState({ from: "", to: "" });
  const [dateError, setDateError] = useState("");
  function applyDates() {
    if (draftDates.from && draftDates.to && draftDates.from > draftDates.to) {
      setDateError("开始日期不能晚于结束日期");
      return;
    }
    setDateError("");
    setDates({ ...draftDates });
  }
  function dateBoundary(value: string, end = false) {
    if (!value) return undefined;
    const date = new Date(`${value}T00:00:00`);
    if (end) date.setDate(date.getDate() + 1);
    return date.toISOString();
  }

  const [sort, setSort] = useState("updated_at");
  const [direction, setDirection] = useState("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<{ ticket?: Ticket } | null>(null);
  const [opening, setOpening] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);
  const [notice, setNotice] = useState("");
  const dragged = useRef<Ticket | null>(null);
  const [page, setPage] = useState(1);
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
    setPage(1);
    const timer = setTimeout(() => {
      api
        .get("/api/v1/tickets/", {
          signal: controller.signal,
          params: {
            mine: view === "board" || mine,
            assignee_id: allTickets && assignee ? assignee : undefined,
            q: query,
            state,
            created_from:
              view === "board" ? dateBoundary(dates.from) : undefined,
            created_before:
              view === "board" ? dateBoundary(dates.to, true) : undefined,
            sort,
            direction,
          },
        })
        .then(({ data }) => {
          if (!controller.signal.aborted) setTickets(data);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(errorMessage(e, "工单加载失败"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    view,
    mine,
    query,
    state,
    sort,
    direction,
    reload,
    allTickets,
    assignee,
    dates,
  ]);
  async function open(ticket: Ticket) {
    if (opening || moving) return;
    setOpening(true);
    setError("");
    try {
      const { data } = await api.get(`/api/v1/tickets/${ticket.id}`);
      setDialog({ ticket: data });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }
  async function move(ticket: Ticket, to: TicketStatus) {
    if (moving || loading || !ticket.can_edit || ticket.status === to) return;
    setMoving(true);
    setError("");
    setNotice("");
    try {
      await api.patch(`/api/v1/tickets/${ticket.id}`, {
        status: to,
        revision: ticket.revision,
      });
      setNotice(`${ticket.ticket_no} 已移至${TICKET_STATUS_CONFIG[to].label}`);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMoving(false);
      setDragging(null);
      setOver(null);
      dragged.current = null;
    }
  }
  const disabled = loading || moving || opening;
  const badge = (ticket: Ticket) => (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${TICKET_PRIORITY_CONFIG[ticket.priority].color}`}
    >
      {TICKET_PRIORITY_CONFIG[ticket.priority].label}
    </span>
  );
  return (
    <Tabs
      value={view}
      onValueChange={(value) => changeView(value as "board" | "list")}
    >
      <PageToolbar compact>
        <TabsList aria-label="工单视图">
          <TabsTrigger value="board" disabled={moving}>
            <LayoutGrid size={16} />
            卡片视图
          </TabsTrigger>
          <TabsTrigger value="list" disabled={moving}>
            <List size={16} />
            列表视图
          </TabsTrigger>
        </TabsList>
        {view === "board" && (
          <Button
            variant="outline"
            aria-expanded={showDates}
            aria-controls="ticket-date-filters"
            onClick={() => setShowDates((v) => !v)}
          >
            <CalendarDays />
            创建日期{dates.from || dates.to ? " · 已筛选" : ""}
            {showDates ? <ChevronUp /> : <ChevronDown />}
          </Button>
        )}
        <NativeSelect
          aria-label="工单开关状态"
          title="打开：除已解决外的所有状态；关闭：已解决"
          className="w-24"
          value={state}
          disabled={moving}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="all">全部</option>
          <option value="open">打开</option>
          <option value="closed">关闭</option>
        </NativeSelect>
        {view === "list" && (
          <NativeSelect
            aria-label="工单范围"
            className="w-36"
            value={mine ? "mine" : "all"}
            onChange={(e) => setMine(e.target.value === "mine")}
          >
            <option value="mine">只看分配给我</option>
            <option value="all">所有人的工单</option>
          </NativeSelect>
        )}
        {allTickets && (
          <NativeSelect
            aria-label="筛选被分配人"
            className="w-40"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">全部被分配人</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="ml-auto flex min-w-40 max-w-80 flex-1 items-center">
          <Input
            aria-label="搜索工单"
            placeholder="搜索工单、项目、状态…"
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <SortMenu
          value={sort}
          direction={direction}
          onChange={setSort}
          onDirectionChange={setDirection}
          options={{
            updated_at: "更新时间",
            created_at: "创建时间",
            system_seq: "系统序号",
            priority: "重要性",
            status: "状态",
            title: "标题",
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="刷新工单"
          disabled={disabled}
          onClick={refresh}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
        <Button
          className="!px-4 !text-sm text-primary-foreground"
          disabled={opening || moving}
          onClick={() => setDialog({})}
        >
          <Plus />
          新建工单
        </Button>
      </PageToolbar>
      {view === "board" && showDates && (
        <Container
          id="ticket-date-filters"
          className="border-b border-border bg-muted/20 py-3"
        >
          <form
            className="flex flex-wrap items-end gap-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              applyDates();
            }}
          >
            <label className="space-y-1 text-xs text-muted-foreground">
              开始日期
              <Input
                type="date"
                aria-label="开始日期"
                className="h-8 w-40 text-xs"
                value={draftDates.from}
                max={draftDates.to || "9999-12-31"}
                onChange={(e) => {
                  setDraftDates((v) => ({ ...v, from: e.target.value }));
                  setDateError("");
                }}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              结束日期
              <Input
                type="date"
                aria-label="结束日期"
                className="h-8 w-40 text-xs"
                value={draftDates.to}
                min={draftDates.from || undefined}
                max="9999-12-30"
                onChange={(e) => {
                  setDraftDates((v) => ({ ...v, to: e.target.value }));
                  setDateError("");
                }}
              />
            </label>
            <Button type="submit" className="h-8 rounded-lg px-4 text-xs">
              确认筛选
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg px-2.5 text-xs"
              onClick={() => {
                setDraftDates({ from: "", to: "" });
                setDates({ from: "", to: "" });
                setDateError("");
              }}
            >
              重置
            </Button>
            <p className="pb-1 text-xs text-muted-foreground">
              按本地时区的创建日期筛选，包含结束当天；留空表示不限。
            </p>
            {dateError && (
              <p role="alert" className="w-full text-xs text-destructive">
                {dateError}
              </p>
            )}
          </form>
        </Container>
      )}
      <TabsContent value={view} asChild>
        <Container className="overflow-x-auto py-6">
          <p className="mb-3 text-xs text-muted-foreground">
            {view === "board" ? "分配给我 · " : ""}共 {tickets.length} 个工单
          </p>
          {allTickets && usersError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              账户加载失败，请刷新重试。
            </p>
          )}
          {error && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <p
            role="status"
            aria-live="polite"
            className="mb-2 text-sm text-muted-foreground"
          >
            {moving ? "正在更新状态…" : notice}
          </p>
          {loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              请刷新工单后重试。
            </div>
          ) : view === "board" ? (
            <>
              <p className="mb-4 text-xs text-muted-foreground">
                仅显示分配给你的工单。拖拽卡片改变状态，也可使用卡片下方的状态选择框。
              </p>
              <div className="flex min-w-max gap-4 pb-4">
                {Object.values(TicketStatus).map((s) => {
                  const config = TICKET_STATUS_CONFIG[s],
                    items = tickets.filter((t) => t.status === s);
                  return (
                    <section
                      key={s}
                      aria-label={config.label}
                      className={`w-72 shrink-0 rounded-xl transition-colors ${over === s ? "bg-primary/5 ring-2 ring-primary" : ""}`}
                      onDragOver={(e) => {
                        if (dragged.current?.can_edit && !moving) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setOver(s);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          setOver(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const ticket = dragged.current;
                        setOver(null);
                        if (ticket) void move(ticket, s);
                      }}
                    >
                      <div
                        className={`mb-3 flex justify-between rounded-lg px-3 py-2 ${config.bgColor}`}
                      >
                        <h2
                          className={`flex items-center gap-2 text-sm font-medium ${config.textColor}`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${config.dotColor}`}
                          />
                          {config.label}
                        </h2>
                        <span className={`text-xs ${config.textColor}`}>
                          {items.length}
                        </span>
                      </div>
                      <div className="min-h-40 space-y-3">
                        {items.map((t) => (
                          <article
                            key={t.id}
                            draggable={t.can_edit && !disabled}
                            onDragStart={(e) => {
                              if (!t.can_edit || disabled) {
                                e.preventDefault();
                                return;
                              }
                              dragged.current = t;
                              setDragging(t.id);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", t.id);
                            }}
                            onDragEnd={() => {
                              dragged.current = null;
                              setDragging(null);
                              setOver(null);
                            }}
                            className={`rounded-xl border bg-background p-4 shadow-sm ${dragging === t.id ? "opacity-40" : ""}`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                                {t.can_edit ? (
                                  <GripVertical size={14} />
                                ) : (
                                  <LockKeyhole size={14} />
                                )}
                                {t.ticket_no}
                              </span>
                              {badge(t)}
                            </div>
                            <button
                              type="button"
                              className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              disabled={opening || moving}
                              onClick={() => void open(t)}
                            >
                              <p className="line-clamp-2 text-sm font-medium hover:text-primary">
                                {t.title}
                              </p>
                              <p className="mt-2 break-words text-xs text-muted-foreground">
                                {t.display_name}
                              </p>
                            </button>
                            {t.status_note && (
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                {t.status_note}
                              </p>
                            )}
                            <p className="my-3 text-xs text-muted-foreground">
                              {t.assignee?.name ?? "未分配"} ·{" "}
                              {new Date(t.updated_at).toLocaleDateString(
                                "zh-CN",
                              )}
                            </p>
                            <NativeSelect
                              aria-label={`${t.ticket_no} 状态`}
                              className="h-8 text-xs"
                              disabled={!t.can_edit || disabled}
                              value={t.status}
                              onChange={(e) =>
                                void move(t, e.target.value as TicketStatus)
                              }
                            >
                              {Object.values(TicketStatus).map((v) => (
                                <option key={v} value={v}>
                                  {TICKET_STATUS_CONFIG[v].label}
                                </option>
                              ))}
                            </NativeSelect>
                          </article>
                        ))}
                        {!items.length && (
                          <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
                            暂无工单{dragging ? " · 拖到此处" : ""}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border">
                <Table className="min-w-[1100px] table-fixed">
                  <colgroup>
                    {allTickets && <col style={{ width: "12%" }} />}
                    <col style={{ width: allTickets ? "22%" : "24%" }} />
                    <col style={{ width: allTickets ? "14%" : "16%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: allTickets ? "18%" : "21%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: allTickets ? "16%" : "21%" }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      {allTickets && <TableHead>分配给</TableHead>}
                      {[
                        "显示名称 / 标题",
                        "项目",
                        "重要性",
                        "简要问题描述",
                        "状态",
                        "下一步计划",
                      ].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tickets.slice((page - 1) * 20, page * 20).map((t) => (
                      <TableRow
                        key={t.id}
                        className="cursor-pointer"
                        onClick={() => void open(t)}
                      >
                        {allTickets && (
                          <TableCell>
                            <p
                              className="truncate font-medium"
                              title={
                                t.assignee
                                  ? `${t.assignee.name} (${t.assignee.email})`
                                  : "未分配"
                              }
                            >
                              {t.assignee?.name ?? "未分配"}
                            </p>
                          </TableCell>
                        )}
                        <TableCell>
                          <button
                            type="button"
                            className="w-full min-w-0 text-left focus-visible:ring-2 focus-visible:ring-ring"
                            disabled={opening}
                            onClick={(e) => {
                              e.stopPropagation();
                              void open(t);
                            }}
                          >
                            <p
                              className="truncate font-medium text-primary"
                              title={t.display_name}
                            >
                              {t.display_name}
                            </p>
                            <p
                              className="mt-1 line-clamp-2 break-words text-sm"
                              title={t.title}
                            >
                              {t.title}
                            </p>
                          </button>
                        </TableCell>
                        <TableCell>
                          <p
                            className="line-clamp-2 break-words"
                            title={t.project_summary}
                          >
                            {t.project_summary}
                          </p>
                        </TableCell>
                        <TableCell>{badge(t)}</TableCell>
                        <TableCell>
                          <p
                            className="line-clamp-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
                            title={t.description || undefined}
                          >
                            {t.description?.trim() || "—"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`whitespace-nowrap ${TICKET_STATUS_CONFIG[t.status].textColor}`}
                          >
                            {TICKET_STATUS_CONFIG[t.status].label}
                          </span>
                          {t.status_note && (
                            <p
                              className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground"
                              title={t.status_note}
                            >
                              {t.status_note}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <p
                            className="line-clamp-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
                            title={t.next_plan || undefined}
                          >
                            {t.next_plan?.trim() || "—"}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!tickets.length && (
                      <TableRow>
                        <TableCell
                          colSpan={allTickets ? 7 : 6}
                          className="h-40 text-center text-muted-foreground"
                        >
                          暂无匹配工单
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  第 {page} 页 · 共 {tickets.length} 条
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * 20 >= tickets.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </Container>
      </TabsContent>
      {dialog && (
        <TicketModal
          ticket={dialog.ticket}
          onClose={() => setDialog(null)}
          onSuccess={refresh}
        />
      )}
    </Tabs>
  );
}
