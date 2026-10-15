"use client";

import {
  ArrowLeft,
  Building2,
  FolderKanban,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { RecordDialog } from "@/components/catalog/record-dialog";
import Container from "@/components/container";
import { TopNav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  type CatalogPage,
  type CatalogRecord,
  type Kind,
  labels,
} from "@/types/catalog";

const configs = {
  customers: {
    icon: Building2,
    singular: "客户",
    sorts: { name: "显示名称", company_name: "公司名", level: "客户级别" },
    columns: [
      ["level", "客户级别"],
      ["country_name", "国家"],
      ["city_name", "城市"],
    ],
  },
  products: {
    icon: Package,
    singular: "产品",
    sorts: { name: "显示名称", model: "型号", type: "类型" },
    columns: [
      ["type", "类型"],
      ["chipset", "芯片"],
      ["system", "系统"],
    ],
  },
  projects: {
    icon: FolderKanban,
    singular: "项目",
    sorts: {
      name: "显示名称",
      number: "项目编号",
      start_month: "立项时间",
      stage: "项目阶段",
    },
    columns: [
      ["pm", "项目经理"],
      ["start_month", "立项时间"],
      ["stage", "项目阶段"],
    ],
  },
};
const time = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";

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
  const [dialog, setDialog] = useState<{ record: CatalogRecord | null } | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: Kind;
    record?: CatalogRecord;
  } | null>(null);
  const [actionError, setActionError] = useState("");
  const config = configs[kind];
  const developer = session?.user.role === "developer";
  const refresh = () => setReload((n) => n + 1);
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
          params: { q: query, sort, direction, page, trash },
          signal: controller.signal,
        })
        .then(({ data: result }) => {
          if (!controller.signal.aborted) setData(result);
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
  async function openRecord(record: CatalogRecord) {
    if (opening || busy) return;
    setOpening(true);
    setError("");
    try {
      const { data: detail } = await api.get(
        `/api/v1/catalog/${kind}/${record.id}`,
      );
      setDialog({ record: detail });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }
  function requestDelete(record?: CatalogRecord) {
    setActionError("");
    setConfirmation({ kind, record });
    setDialog(null);
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
    setSort(trash ? "updated_at" : "deleted_at");
    setDirection("desc");
    setQuery("");
    setPage(1);
    setNotice("");
    setData({ items: [], total: 0 });
  }
  return (
    <>
      <TopNav title="数据维护" />
      <Tabs
        value={kind}
        onValueChange={(value) => {
          setKind(value as Kind);
          setQuery("");
          setSort(trash ? "deleted_at" : "updated_at");
          setDirection("desc");
          setPage(1);
          setNotice("");
          setData({ items: [], total: 0 });
        }}
      >
        <PageToolbar>
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
          <div className="ml-auto min-w-40 max-w-80 flex-1">
            <Input
              aria-label="搜索记录"
              placeholder={
                trash
                  ? `搜索最近删除的${config.singular}…`
                  : `搜索${config.singular}…`
              }
              maxLength={200}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <SortMenu
            value={sort}
            direction={direction}
            options={{
              updated_at: "更新时间",
              created_at: "创建时间",
              ...(trash ? { deleted_at: "删除时间" } : {}),
              ...config.sorts,
            }}
            onChange={(v) => {
              setSort(v);
              setPage(1);
            }}
            onDirectionChange={(v) => {
              setDirection(v);
              setPage(1);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新资料"
            disabled={busy || loading}
            onClick={refresh}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
          <Button
            variant={trash ? "secondary" : "outline"}
            aria-pressed={trash}
            disabled={busy || opening}
            onClick={changeTrash}
          >
            {trash ? <ArrowLeft /> : <Trash2 />}
            {trash ? "返回资料库" : "最近删除"}
          </Button>
          {!trash && (
            <Button
              className="text-white"
              disabled={busy || opening}
              onClick={() => setDialog({ record: null })}
            >
              <Plus />
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
        </PageToolbar>
        <Container className="overflow-x-auto py-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {trash ? `${labels[kind]} · 最近删除` : `${labels[kind]}`} · 共{" "}
              {data.total} 条
            </span>
            {trash && (
              <span className="text-xs">
                可恢复误删记录；仅开发者可永久清空。
              </span>
            )}
          </div>
          {notice && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <TabsContent value={kind} className="mt-0">
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>显示名称</TableHead>
                    {config.columns.map(([key, name]) => (
                      <TableHead key={key}>{name}</TableHead>
                    ))}
                    {trash ? (
                      <>
                        <TableHead>删除人</TableHead>
                        <TableHead>删除时间</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead>创建人</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead>更新人</TableHead>
                        <TableHead>更新时间</TableHead>
                      </>
                    )}
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={trash ? 7 : 9}
                        className="h-44 text-center text-muted-foreground"
                      >
                        加载中…
                      </TableCell>
                    </TableRow>
                  ) : error ? (
                    <TableRow>
                      <TableCell
                        colSpan={trash ? 7 : 9}
                        className="h-44 text-center text-muted-foreground"
                      >
                        数据暂不可用，请刷新重试。
                      </TableCell>
                    </TableRow>
                  ) : !data.items.length ? (
                    <TableRow>
                      <TableCell
                        colSpan={trash ? 7 : 9}
                        className="h-44 text-center text-muted-foreground"
                      >
                        {query
                          ? "没有匹配记录，请调整搜索内容。"
                          : trash
                            ? "最近删除为空。"
                            : `暂无${config.singular}，点击右上角新建。`}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.items.map((record) => (
                      <TableRow
                        key={record.id}
                        className="cursor-pointer"
                        onClick={() => void openRecord(record)}
                      >
                        <TableCell className="min-w-64">
                          <button
                            type="button"
                            disabled={opening || busy}
                            className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openRecord(record);
                            }}
                          >
                            {record.display_name}
                          </button>
                        </TableCell>
                        {config.columns.map(([key]) => (
                          <TableCell key={key} className="whitespace-nowrap">
                            {String(record[key as keyof CatalogRecord] ?? "—")}
                          </TableCell>
                        ))}
                        {trash ? (
                          <>
                            <TableCell>
                              {record.deleted_by_name ?? "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {time(record.deleted_at)}
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell>{record.created_by_name}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {time(record.created_at)}
                            </TableCell>
                            <TableCell>{record.updated_by_name}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {time(record.updated_at)}
                            </TableCell>
                          </>
                        )}
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {trash ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || opening}
                              aria-label={`恢复 ${record.display_name}`}
                              onClick={() => void restore(record)}
                            >
                              <RotateCcw />
                              恢复
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={busy || opening}
                              aria-label={`删除 ${record.display_name}`}
                              onClick={() => requestDelete(record)}
                            >
                              <Trash2 />
                              删除
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>第 {page} 页</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || busy || page <= 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || busy || page * 20 >= data.total}
                  onClick={() => setPage((v) => v + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </TabsContent>
          {kind === "customers" && (
            <p className="mt-5 text-xs text-muted-foreground">
              国家和城市数据：GeoNames（CC BY 4.0）。
            </p>
          )}
        </Container>
      </Tabs>
      {dialog && (
        <RecordDialog
          kind={kind}
          record={dialog.record}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          onDelete={requestDelete}
        />
      )}
      {confirmation && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmation(null);
          }}
        >
          <DialogContent
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            className="max-w-lg p-6"
          >
            <DialogTitle className="pr-6 text-lg font-semibold">
              {confirmation.record ? "移至最近删除" : "清空最近删除"}
            </DialogTitle>
            <DialogDescription className="break-words text-sm leading-6 text-muted-foreground">
              {confirmation.record
                ? `将「${confirmation.record.display_name}」移至最近删除？未被引用的记录才可删除，之后可恢复。`
                : `永久删除${labels[confirmation.kind]}最近删除中的全部记录，包含当前搜索未显示的记录。此操作无法恢复；被引用的记录会阻止清空。`}
            </DialogDescription>
            {actionError && (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void confirmAction()}
              >
                {busy && <Loader2 className="animate-spin" />}
                {confirmation.record ? "确认移入" : "永久清空"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
