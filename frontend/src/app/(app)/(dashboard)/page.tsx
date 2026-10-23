"use client";
import { useUiTranslations } from "@/i18n/client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Ticket,
  BookOpen,
  CheckCircle,
  Clock,
  Loader2,
  Bot,
} from "lucide-react";
import apiClient from "@/lib/api";

interface Stats {
  total: number;
  open: number;
  in_progress: number;
  pending: number;
  resolved: number;
  reproducing: number;
  verifying: number;
}
interface Todo {
  task: string;
  priority: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  major: "bg-orange-400",
  medium: "bg-yellow-400",
  trivial: "bg-green-400",
};

export default function DashboardPage() {
  const t = useUiTranslations();

  const { data: session } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loadS, setLoadS] = useState(true);
  const [loadT, setLoadT] = useState(false);
  const [todoGenerated, setTodoGenerated] = useState(false);

  useEffect(() => {
    apiClient
      .get("/api/v1/tickets/stats")
      .then((r) => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoadS(false));
  }, []);

  async function generateTodos() {
    setLoadT(true);
    try {
      const r = await apiClient.get("/api/v1/ai/todos");
      setTodos(r.data.todos ?? []);
      setTodoGenerated(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadT(false);
    }
  }

  const name = session?.user?.name ?? t("ui.user");
  const role = session?.user?.role ?? "";

  const statCards = stats
    ? [
        {
          label: t("ui.allTickets"),
          value: stats.total,
          icon: <Ticket size={18} />,
          color: "text-blue-500",
          bg: "bg-blue-50 dark:bg-blue-950/30",
        },
        {
          label: t("ui.new"),
          value: stats.open,
          icon: <Clock size={18} />,
          color: "text-amber-500",
          bg: "bg-amber-50 dark:bg-amber-950/30",
        },
        {
          label: t("ui.inProgress"),
          value: stats.in_progress,
          icon: <Loader2 size={18} />,
          color: "text-violet-500",
          bg: "bg-violet-50 dark:bg-violet-950/30",
        },
        {
          label: t("ui.Onhold"),
          value: stats.pending,
          icon: <Clock size={18} />,
          color: "text-yellow-500",
          bg: "bg-yellow-50 dark:bg-yellow-950/30",
        },
        {
          label: t("ui.resolved"),
          value: stats.resolved,
          icon: <CheckCircle size={18} />,
          color: "text-green-500",
          bg: "bg-green-50 dark:bg-green-950/30",
        },
        {
          label: t("ui.reproducing"),
          value: stats.reproducing,
          icon: <BookOpen size={18} />,
          color: "text-slate-500",
          bg: "bg-slate-50 dark:bg-slate-800/30",
        },
        {
          label: t("ui.verifying"),
          value: stats.verifying,
          icon: <CheckCircle size={18} />,
          color: "text-cyan-500",
          bg: "bg-cyan-50 dark:bg-cyan-950/30",
        },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* 欢迎语 */}
      <div>
        <h1 className="text-xl font-bold">
          {t("ui.hello")}
          {name} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {role === "developer" || role === "leader"
            ? t("ui.hereIsYourTeamSTicketOverview")
            : t("ui.hereIsYourTicketOverview")}
        </p>
      </div>

      {/* 统计卡片 */}
      {loadS ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" /> {t("ui.loading")}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {statCards.map((c) => (
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
            <p className="text-sm font-medium">{t("ui.resolutionRate")}</p>
            <p className="text-sm font-bold text-green-500">
              {Math.round((stats.resolved / stats.total) * 100)}%
            </p>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5 rounded-full transition-all duration-700"
              style={{
                width: `${Math.round((stats.resolved / stats.total) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>
              {t("ui.resolved2")}
              {stats.resolved}
            </span>
            <span>
              {t("ui.total")}
              {stats.total}
            </span>
          </div>
        </div>
      )}

      {/* AI TODO 面板 */}
      <div className="bg-background border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600
                            flex items-center justify-center"
            >
              <Bot size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                {t("ui.todaySAiTodoList")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("ui.generatedFromYourTickets")}
              </p>
            </div>
          </div>
          <button
            onClick={generateTodos}
            disabled={loadT}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary
                       text-primary-foreground rounded-lg hover:bg-primary/90
                       disabled:opacity-50 transition-colors"
          >
            {loadT ? (
              <>
                <Loader2 size={13} className="animate-spin" />{" "}
                {t("ui.generating")}
              </>
            ) : todoGenerated ? (
              t("ui.regenerate")
            ) : (
              t("ui.generateTodos")
            )}
          </button>
        </div>

        {todos.length > 0 ? (
          <ul className="space-y-2.5">
            {todos.map((t, i) => (
              <li
                key={i}
                className="flex items-start gap-3 py-2 border-b border-border last:border-0"
              >
                <div
                  className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0
                                 ${PRIORITY_COLORS[t.priority] ?? "bg-slate-400"}`}
                />
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
            <p className="text-sm">
              {t("ui.clickGenerateTodosToPlanYourDayWithAi")}
            </p>
          </div>
        )}
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QuickCard
          title={t("ui.ticketBoard")}
          desc={t("ui.viewAndManageAllTickets")}
          icon={<Ticket size={20} />}
          color="from-blue-500 to-cyan-500"
          onClick={() => router.push("/ticket")}
        />
        <QuickCard
          title={t("ui.knowledgeBase")}
          desc={t("ui.readTechnicalDocumentsAndAskAi")}
          icon={<BookOpen size={20} />}
          color="from-violet-500 to-purple-600"
          onClick={() => router.push("/knowledge")}
        />
      </div>
    </div>
  );
}

function QuickCard({
  title,
  desc,
  icon,
  color,
  onClick,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-5 bg-background border border-border
                 rounded-2xl hover:shadow-md hover:border-primary/30 transition-all
                 duration-200 text-left w-full group"
    >
      <div
        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color}
                       flex items-center justify-center flex-shrink-0
                       group-hover:scale-110 transition-transform duration-200`}
      >
        <span className="text-white">{icon}</span>
      </div>
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </button>
  );
}
