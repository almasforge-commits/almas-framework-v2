import { memo, useMemo } from "react";
import type { DashboardSummary } from "../../api/apiTypes";
import { DashboardCard } from "./DashboardCard";

function formatExpenses(summary: DashboardSummary): string {
  return `${summary.expensesToday.toLocaleString("ru-RU")} ${summary.expensesTodayCurrency}`;
}

export const StatsGrid = memo(function StatsGrid({
  summary,
}: {
  summary: DashboardSummary;
}) {
  const cards = useMemo(
    () => [
      {
        key: "expenses",
        icon: "💰",
        title: "Расходы сегодня",
        value: formatExpenses(summary),
        subtitle: "За текущий день",
        to: "/finance",
        ariaLabel: `Расходы сегодня: ${formatExpenses(summary)}`,
      },
      {
        key: "tasks",
        icon: "📋",
        title: "Активные задачи",
        value: String(summary.activeTasks),
        subtitle: "В работе",
        to: "/tasks",
        ariaLabel: `Активные задачи: ${summary.activeTasks}`,
      },
      {
        key: "knowledge",
        icon: "📚",
        title: "Знания",
        value: String(summary.newKnowledge),
        subtitle: "Новые объекты",
        to: "/knowledge",
        ariaLabel: `Знания: ${summary.newKnowledge}`,
      },
      {
        key: "ideas",
        icon: "💡",
        title: "Идеи",
        value: String(summary.inboxToday),
        subtitle: "Inbox сегодня",
        to: "/inbox",
        ariaLabel: `Идеи и объекты Inbox сегодня: ${summary.inboxToday}`,
      },
    ],
    [summary]
  );

  return (
    <div
      className="grid grid-cols-2 gap-3"
      data-testid="dashboard-stats"
      role="list"
    >
      {cards.map((card) => (
        <div key={card.key} role="listitem">
          <DashboardCard
            icon={card.icon}
            title={card.title}
            value={card.value}
            subtitle={card.subtitle}
            to={card.to}
            ariaLabel={card.ariaLabel}
          />
        </div>
      ))}
    </div>
  );
});
