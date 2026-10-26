"use client";

import {
  BookOpen,
  Bot,
  CheckCircle,
  Clock,
  Loader2,
  Ticket,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUiTranslations } from "@/i18n/client";
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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* 欢迎语 */}
      <div>
        <h1 className="text-xl font-bold">
          {t("ui.hello")}
          {name} 👋
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {role === "developer" || role === "leader"
            ? t("ui.hereIsYourTeamSTicketOverview")
            : t("ui.hereIsYourTicketOverview")}
        </p>
      </div>

      {/* 统计卡片 */}
      {loadS ? (
        <div className="text-muted-foreground flex items-center justify-center py-12">
          <Loader2 size={20} className="mr-2 animate-spin" /> {t("ui.loading")}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {statCards.map((c) => (
            <div
              key={c.label}
              onClick={() => router.push("/ticket")}
              className={`${c.bg} cursor-pointer rounded-2xl p-4 transition-transform duration-200 hover:scale-105`}
            >
              <div className={`${c.color} mb-2`}>{c.icon}</div>
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 解决率进度条 */}
      {stats && stats.total > 0 && (
        <div className="bg-background border-border rounded-2xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">{t("ui.resolutionRate")}</p>
            <p className="text-sm font-bold text-green-500">
              {Math.round((stats.resolved / stats.total) * 100)}%
            </p>
          </div>
          <div className="bg-muted h-2.5 w-full rounded-full">
            <div
              className="h-2.5 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-700"
              style={{
                width: `${Math.round((stats.resolved / stats.total) * 100)}%`,
              }}
            />
          </div>
          <div className="text-muted-foreground mt-2 flex justify-between text-xs">
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
      <div className="bg-background border-border rounded-2xl border p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600">
              <Bot size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                {t("ui.todaySAiTodoList")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("ui.generatedFromYourTickets")}
              </p>
            </div>
          </div>
          <button
            onClick={generateTodos}
            disabled={loadT}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
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
                className="border-border flex items-start gap-3 border-b py-2 last:border-0"
              >
                <div
                  className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${PRIORITY_COLORS[t.priority] ?? "bg-slate-400"}`}
                />
                <span className="text-sm">{t.task}</span>
                <span className="text-muted-foreground ml-auto flex-shrink-0 text-xs capitalize">
                  {t.priority}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground py-8 text-center">
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
      className="bg-background border-border hover:border-primary/30 group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition-all duration-200 hover:shadow-md"
    >
      <div
        className={`h-10 w-10 rounded-xl bg-gradient-to-br ${color} flex flex-shrink-0 items-center justify-center transition-transform duration-200 group-hover:scale-110`}
      >
        <span className="text-white">{icon}</span>
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{desc}</p>
      </div>
    </button>
  );
}
