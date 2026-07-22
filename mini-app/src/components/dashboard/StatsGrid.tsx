import { memo, useMemo } from "react";
import type { DashboardSummary } from "../../api/apiTypes";
import { DashboardCard } from "./DashboardCard";

function formatMoney(amount: number, currency: string): string {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe.toLocaleString("ru-RU")} ${currency}`;
}

export const StatsGrid = memo(function StatsGrid({
  summary,
}: {
  summary: DashboardSummary;
}) {
  const currency = summary.baseCurrency || summary.expensesTodayCurrency;
  const income = Number(summary.incomeToday ?? 0);
  const expense = Number(summary.expensesToday ?? 0);
  const balance = Number(
    summary.balanceToday ?? income - expense
  );

  const cards = useMemo(
    () => [
      {
        key: "balance",
        icon: "💼",
        title: `Баланс в ${currency}`,
        value: formatMoney(balance, currency),
        subtitle: "Все валюты после конвертации",
        to: "/finance",
        ariaLabel: `Баланс: ${formatMoney(balance, currency)}`,
      },
      {
        key: "income",
        icon: "💵",
        title: `Доход в ${currency}`,
        value: formatMoney(income, currency),
        subtitle: "С учётом USD / VND / KZT",
        to: "/finance",
        ariaLabel: `Доход: ${formatMoney(income, currency)}`,
      },
      {
        key: "expenses",
        icon: "💰",
        title: `Расход в ${currency}`,
        value: formatMoney(expense, currency),
        subtitle: "С учётом всех валют",
        to: "/finance",
        ariaLabel: `Расход: ${formatMoney(expense, currency)}`,
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
    ],
    [summary.activeTasks, balance, currency, expense, income]
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
