import { useEffect, useState } from "react";
import { apiClient } from "../api/apiClient";
import type {
  FinancePeriod,
  FinanceSummary,
  FinanceTransaction,
} from "../api/apiTypes";
import { mapApiErrorToUi, type ApiErrorUi } from "../api/apiErrors";
import { DemoNotice } from "../components/DemoNotice";
import { ErrorState } from "../components/ErrorState";
import { Header } from "../components/Header";
import { LoadingState } from "../components/LoadingState";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { isMockMode } from "../config/env";

const PERIODS: Array<{ id: FinancePeriod; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

export function FinancePage() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = () => {
    setLoading(true);
    setErrorUi(null);
    Promise.all([
      apiClient.getFinanceSummary(period),
      apiClient.getFinanceTransactions(period),
    ])
      .then(([nextSummary, nextTx]) => {
        setSummary(nextSummary);
        setTransactions(nextTx);
      })
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [period]);

  return (
    <div>
      <Header
        title="Финансы"
        subtitle={isMockMode() ? "Только просмотр · демо" : "Ваши финансы"}
      />
      <div className="space-y-4 px-4 pt-4">
        <DemoNotice />

        <div className="flex gap-2" role="tablist" aria-label="Период">
          {PERIODS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={period === entry.id}
              onClick={() => setPeriod(entry.id)}
              className={[
                "tap-target flex-1 rounded-xl px-2 py-2 text-sm font-medium",
                period === entry.id
                  ? "bg-tg-button text-tg-button-text"
                  : "bg-tg-secondary text-tg-hint",
              ].join(" ")}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {loading ? <LoadingState /> : null}
        {errorUi ? <ErrorState errorUi={errorUi} onRetry={load} /> : null}

        {summary && !loading && !errorUi ? (
          <div className="grid grid-cols-1 gap-3">
            <MetricCard
              label={`Баланс в ${summary.baseCurrency || summary.currency}`}
              value={
                summary.fxStatus === "unavailable" && summary.balanceBase == null
                  ? "Курсы недоступны"
                  : `${(summary.balanceBase ?? summary.balance).toLocaleString("ru-RU")} ${summary.baseCurrency || summary.currency}`
              }
              hint={
                summary.fxStatus === "partial"
                  ? "Частичная конвертация"
                  : summary.fxStatus === "unavailable"
                    ? "Показаны исходные валюты ниже"
                    : summary.demo
                      ? "Демо"
                      : undefined
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label={`Общий доход`}
                value={
                  summary.incomeBase == null && summary.fxStatus === "unavailable"
                    ? "—"
                    : `${(summary.incomeBase ?? summary.incomeMonth).toLocaleString("ru-RU")} ${summary.baseCurrency || summary.currency}`
                }
              />
              <MetricCard
                label={`Общий расход`}
                value={
                  summary.expenseBase == null && summary.fxStatus === "unavailable"
                    ? "—"
                    : `${(summary.expenseBase ?? summary.expensesMonth).toLocaleString("ru-RU")} ${summary.baseCurrency || summary.currency}`
                }
              />
            </div>
            {summary.originalCurrencyTotals &&
            summary.originalCurrencyTotals.length > 0 ? (
              <SectionCard title="В том числе">
                <ul className="space-y-1 text-sm text-tg-hint">
                  {summary.originalCurrencyTotals.map((row) => (
                    <li key={row.currency}>
                      {row.income
                        ? `Доход ${row.income.toLocaleString("ru-RU")} ${row.currency}`
                        : null}
                      {row.income && row.expense ? " · " : null}
                      {row.expense
                        ? `Расход ${row.expense.toLocaleString("ru-RU")} ${row.currency}`
                        : null}
                    </li>
                  ))}
                </ul>
                {summary.ratesUpdatedAt ? (
                  <p className="mt-2 text-xs text-tg-hint">
                    Курс обновлён:{" "}
                    {new Date(summary.ratesUpdatedAt).toLocaleString("ru-RU")}
                  </p>
                ) : null}
                {summary.fxStatus && summary.fxStatus !== "ok" ? (
                  <p className="mt-1 text-xs text-tg-hint">
                    FX: {summary.fxStatus}
                  </p>
                ) : null}
              </SectionCard>
            ) : null}
          </div>
        ) : null}

        <SectionCard title="Последние операции">
          <ul className="space-y-3">
            {transactions.map((tx) => (
              <li key={tx.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{tx.description}</p>
                  <p className="text-xs text-tg-hint">
                    {tx.category} · {tx.date}
                  </p>
                </div>
                <span
                  className={[
                    "shrink-0 font-medium",
                    tx.type === "income" ? "text-emerald-600" : "text-tg-text",
                  ].join(" ")}
                >
                  {tx.type === "income" ? "+" : "−"}
                  {tx.amount.toLocaleString("ru-RU")} {tx.currency}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
