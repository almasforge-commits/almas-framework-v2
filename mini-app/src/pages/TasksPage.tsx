import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/apiClient";
import type { Task } from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { SectionCard } from "../components/SectionCard";

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = () => {
    setLoading(true);
    setErrorUi(null);
    apiClient
      .getTasks()
      .then(setTasks)
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const grouped = useMemo(
    () => ({
      today: tasks.filter((task) => task.group === "today"),
      upcoming: tasks.filter((task) => task.group === "upcoming"),
      done: tasks.filter((task) => task.group === "done"),
    }),
    [tasks]
  );

  const toggle = async (task: Task) => {
    const nextCompleted = !task.completed;
    setTasks((prev) =>
      prev.map((entry) =>
        entry.id === task.id
          ? {
              ...entry,
              completed: nextCompleted,
              group: nextCompleted ? "done" : "today",
              dueLabel: nextCompleted ? "Выполнено" : "Сегодня",
            }
          : entry
      )
    );
    await apiClient.patchTask(task.id, { completed: nextCompleted });
  };

  const renderGroup = (title: string, list: Task[]) => (
    <SectionCard title={title}>
      {list.length === 0 ? (
        <p className="text-sm text-tg-hint">Пусто</p>
      ) : (
        <ul className="space-y-2">
          {list.map((task) => (
            <li key={task.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1 py-1">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => void toggle(task)}
                  aria-label={`Отметить задачу: ${task.title}`}
                  className="h-5 w-5 accent-[var(--tg-button)]"
                />
                <span
                  className={[
                    "text-sm",
                    task.completed ? "text-tg-hint line-through" : "text-tg-text",
                  ].join(" ")}
                >
                  {task.title}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  return (
    <div>
      <Header title="Задачи" subtitle="Локальные переключатели · демо" />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />
        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}
        {!loading && !errorUi && tasks.length === 0 ? (
          <EmptyState title="Нет задач" />
        ) : null}
        {!loading && !errorUi ? (
          <>
            {renderGroup("Сегодня", grouped.today)}
            {renderGroup("Предстоящие", grouped.upcoming)}
            {renderGroup("Выполненные", grouped.done)}
          </>
        ) : null}
      </div>
    </div>
  );
}
