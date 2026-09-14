"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Ticket, BookOpen, CheckCircle, Clock, Loader2, Bot } from "lucide-react";
import apiClient from "@/lib/api";

interface Stats {
  total: number; open: number; in_progress: number;
  pending: number; resolved: number; closed: number;
}
interface Todo { task: string; priority: string; }

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-400",
  medium:   "bg-yellow-400",
  low:      "bg-green-400",
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [stats,  setStats]  = useState<Stats | null>(null);
  const [todos,  setTodos]  = useState<Todo[]>([]);
  const [loadS,  setLoadS]  = useState(true);
  const [loadT,  setLoadT]  = useState(false);
  const [todoGenerated, setTodoGenerated] = useState(false);

  useEffect(() => {
    apiClient.get("/api/v1/tickets/stats")
      .then(r => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoadS(false));
  }, []);

  async function generateTodos() {
    setLoadT(true);
    try {
      const r = await apiClient.get("/api/v1/ai/todos");
      setTodos(r.data.todos ?? []);
      setTodoGenerated(true);
    } catch (e) { console.error(e); }
    finally { setLoadT(false); }
  }

  const name = session?.user?.name ?? "用户";
  const role = session?.user?.role ?? "";

  const statCards = stats ? [
    { label: "全部工单",  value: stats.total,       icon: <Ticket size={18} />,       color: "text-blue-500",   bg: "bg-blue-50 dark:bg-blue-950/30"   },
    { label: "待处理",    value: stats.open,         icon: <Clock size={18} />,         color: "text-amber-500",  bg: "bg-amber-50 dark:bg-amber-950/30" },
    { label: "处理中",    value: stats.in_progress,  icon: <Loader2 size={18} />,       color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/30"},
    { label: "等待客户",  value: stats.pending,      icon: <Clock size={18} />,         color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-950/30"},
    { label: "已解决",    value: stats.resolved,     icon: <CheckCircle size={18} />,   color: "text-green-500",  bg: "bg-green-50 dark:bg-green-950/30" },
    { label: "已关闭",    value: stats.closed,       icon: <BookOpen size={18} />,      color: "text-slate-500",  bg: "bg-slate-50 dark:bg-slate-800/30" },
  ] : [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* 欢迎语 */}
      <div>
        <h1 className="text-xl font-bold">
          你好，{name} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {role === "developer" || role === "leader"
            ? "以下是团队整体工单概况"
            : "以下是你的工单概况"}
        </p>
      </div>

      {/* 统计卡片 */}
      {loadS ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {statCards.map(c => (
            <div
              key={c.label}
              onClick={() => router.push("/ticket")}
              className={`${c.bg} rounded-2xl p-4 cursor-pointer
                          hover:scale-105 transition-transform duration-200`}
            >
              <div className={`${c.color} mb-2`}>{c.icon}</div>
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 解决率进度条 */}
      {stats && stats.total > 0 && (
        <div className="bg-background border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">工单解决率</p>
            <p className="text-sm font-bold text-green-500">
              {Math.round(((stats.resolved + stats.closed) / stats.total) * 100)}%
            </p>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5 rounded-full transition-all duration-700"
              style={{ width: `${Math.round(((stats.resolved + stats.closed) / stats.total) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>已解决 + 已关闭：{stats.resolved + stats.closed}</span>
            <span>合计：{stats.total}</span>
          </div>
        </div>
      )}

      {/* AI TODO 面板 */}
      <div className="bg-background border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600
                            flex items-center justify-center">
              <Bot size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold">今日 AI TODO 清单</p>
              <p className="text-xs text-muted-foreground">基于你的工单自动生成</p>
            </div>
          </div>
          <button
            onClick={generateTodos}
            disabled={loadT}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary
                       text-primary-foreground rounded-lg hover:bg-primary/90
                       disabled:opacity-50 transition-colors"
          >
            {loadT
              ? <><Loader2 size={13} className="animate-spin" /> 生成中...</>
              : todoGenerated ? "重新生成" : "▶ 生成 TODO"}
          </button>
        </div>

        {todos.length > 0 ? (
          <ul className="space-y-2.5">
            {todos.map((t, i) => (
              <li key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0
                                 ${PRIORITY_COLORS[t.priority] ?? "bg-slate-400"}`} />
                <span className="text-sm">{t.task}</span>
                <span className="ml-auto text-xs text-muted-foreground flex-shrink-0 capitalize">
                  {t.priority}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Bot size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">点击&quot;生成 TODO&quot;让 AI 帮你规划今日工作</p>
          </div>
        )}
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QuickCard
          title="工单看板"
          desc="查看和管理所有工单"
          icon={<Ticket size={20} />}
          color="from-blue-500 to-cyan-500"
          onClick={() => router.push("/ticket")}
        />
        <QuickCard
          title="知识库"
          desc="查阅技术文档，提问 AI"
          icon={<BookOpen size={20} />}
          color="from-violet-500 to-purple-600"
          onClick={() => router.push("/knowledge")}
        />
      </div>
    </div>
  );
}

function QuickCard({ title, desc, icon, color, onClick }: {
  title: string; desc: string;
  icon: React.ReactNode; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-5 bg-background border border-border
                 rounded-2xl hover:shadow-md hover:border-primary/30 transition-all
                 duration-200 text-left w-full group"
    >
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color}
                       flex items-center justify-center flex-shrink-0
                       group-hover:scale-110 transition-transform duration-200`}>
        <span className="text-white">{icon}</span>
      </div>
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </button>
  );
}
