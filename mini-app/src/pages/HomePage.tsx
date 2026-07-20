import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api/apiClient";
import type { HomePayload } from "../api/apiTypes";
import { DemoNotice } from "../components/DemoNotice";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { useTelegram } from "../telegram/TelegramProvider";

function formatToday(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

export function HomePage() {
  const { user, browserPreview } = useTelegram();
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    apiClient
      .getDashboard(user.first_name || null)
      .then(setData)
      .catch(() => setError("Ошибка загрузки дашборда"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user.first_name]);

  const greeting = user.first_name
    ? `Привет, ${user.first_name}`
    : "Добро пожаловать";

  return (
    <div>
      <Header
        title={greeting}
        subtitle={formatToday()}
        right={
          <div className="text-right">
            <span className="inline-flex items-center gap-1 rounded-full bg-tg-secondary px-2 py-1 text-[11px] text-tg-hint">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              {data?.summary.statusLabel ?? "ALMAS"}
            </span>
            {browserPreview ? (
              <p className="mt-1 text-[10px] text-tg-hint" data-testid="browser-preview">
                Browser preview
              </p>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState description={error} onRetry={load} /> : null}

        {data && !loading ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Inbox сегодня" value={String(data.summary.inboxToday)} />
              <MetricCard
                label="Расходы сегодня"
                value={`${data.summary.expensesToday.toLocaleString("ru-RU")} ${data.summary.expensesTodayCurrency}`}
              />
              <MetricCard label="Активные задачи" value={String(data.summary.activeTasks)} />
              <MetricCard label="Новые знания" value={String(data.summary.newKnowledge)} />
            </div>

            <SectionCard title="Сегодня">
              <ul className="space-y-3">
                {data.todayActivity.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-tg-hint">{item.subtitle}</p>
                    </div>
                    <span className="shrink-0 text-xs text-tg-hint">{item.time}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard
              title="Последние задачи"
              action={
                <Link to="/tasks" className="text-xs font-medium text-tg-link">
                  Все
                </Link>
              }
            >
              <ul className="space-y-2">
                {data.recentTasks.map((task) => (
                  <li key={task.id} className="text-sm">
                    {task.title}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard
              title="Новые знания"
              action={
                <Link to="/knowledge" className="text-xs font-medium text-tg-link">
                  Все
                </Link>
              }
            >
              <ul className="space-y-2">
                {data.recentKnowledge.map((item) => (
                  <li key={item.id} className="text-sm">
                    {item.title}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Последние действия">
              <ul className="space-y-2">
                {data.recentActions.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2 text-sm">
                    <span className="truncate">{item.title}</span>
                    <span className="shrink-0 text-xs text-tg-hint">{item.time}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </>
        ) : null}
      </div>
    </div>
  );
}
