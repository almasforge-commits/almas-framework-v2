import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/apiClient";
import type {
  FinancePeriod,
  FinanceSummary,
  FinanceTransaction,
  OriginalCurrencyTotal,
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
  { id: "today", label: "Сегодня" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

function money(amount: number, currency: string) {
  return `${amount.toLocaleString("ru-RU")} ${currency}`;
}

function CurrencyBreakdown({
  totals,
}: {
  totals: OriginalCurrencyTotal[];
}) {
  const incomeRows = totals.filter((row) => row.income > 0);
  const expenseRows = totals.filter((row) => row.expense > 0);
  if (!incomeRows.length && !expenseRows.length) return null;

  return (
    <SectionCard title="В том числе">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-tg-hint">
            Доходы
          </p>
          {incomeRows.length === 0 ? (
            <p className="mt-2 text-sm text-tg-hint">Нет доходов</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {incomeRows.map((row) => (
                <li
                  key={`in-${row.currency}`}
                  className="flex justify-between gap-3 text-sm text-tg-text"
                >
                  <span>{row.currency}</span>
                  <span className="tabular-nums font-medium text-emerald-600">
                    {money(row.income, row.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-tg-hint">
            Расходы
          </p>
          {expenseRows.length === 0 ? (
            <p className="mt-2 text-sm text-tg-hint">Нет расходов</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {expenseRows.map((row) => (
                <li
                  key={`ex-${row.currency}`}
                  className="flex justify-between gap-3 text-sm text-tg-text"
                >
                  <span>{row.currency}</span>
                  <span className="tabular-nums font-medium">
                    {money(row.expense, row.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function FinancePage() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorUi, setErrorUi] = useState<ApiErrorUi | null>(null);

  const load = () => {
    setLoading(true);
    setErrorUi(null);
    // One HTTP round-trip (SQL + FX once) instead of summary+transactions waterfall.
    apiClient
      .getFinanceOverview(period)
      .then((overview) => {
        setSummary(overview.summary);
        const seen = new Set<string>();
        setTransactions(
          overview.transactions.filter((tx) => {
            if (!tx.id) return true;
            if (seen.has(tx.id)) return false;
            seen.add(tx.id);
            return true;
          })
        );
      })
      .catch((error: unknown) => setErrorUi(mapApiErrorToUi(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [period]);

  const base = summary?.baseCurrency || summary?.currency || "VND";
  const canShowCombined =
    summary &&
    !(summary.fxStatus === "unavailable" && summary.balanceBase == null);

  const ratesHint = useMemo(() => {
    if (!summary?.ratesUpdatedAt) return null;
    try {
      return `Курс обновлён: ${new Date(summary.ratesUpdatedAt).toLocaleString("ru-RU")}`;
    } catch {
      return null;
    }
  }, [summary?.ratesUpdatedAt]);

  return (
    <div>
      <Header
        title="Финансы"
        subtitle={isMockMode() ? "Только просмотр · демо" : "Ваши финансы"}
      />
      <div className="space-y-4 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
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
          <div className="grid gap-3">
            <MetricCard
              label={`Общий баланс в ${base}`}
              value={
                canShowCombined
                  ? money(summary.balanceBase ?? summary.balance, base)
                  : "Сумма будет доступна после обновления курсов"
              }
              hint={ratesHint || undefined}
            />
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label={`Общий доход в ${base}`}
                value={
                  canShowCombined
                    ? money(summary.incomeBase ?? summary.incomeMonth, base)
                    : "—"
                }
              />
              <MetricCard
                label={`Общий расход в ${base}`}
                value={
                  canShowCombined
                    ? money(summary.expenseBase ?? summary.expensesMonth, base)
                    : "—"
                }
              />
            </div>
            {summary.originalCurrencyTotals?.length ? (
              <CurrencyBreakdown totals={summary.originalCurrencyTotals} />
            ) : null}
          </div>
        ) : null}

        <SectionCard title="Последние операции">
          {loading ? null : transactions.length === 0 ? (
            <p className="text-sm text-tg-hint">Нет операций</p>
          ) : (
            <ul className="space-y-3">
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{tx.description || "Операция"}</p>
                    <p className="text-xs text-tg-hint">
                      {[
                        tx.category && tx.category !== "other"
                          ? tx.category
                          : null,
                        tx.date,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={[
                      "shrink-0 font-medium tabular-nums",
                      tx.type === "income" ? "text-emerald-600" : "text-tg-text",
                    ].join(" ")}
                  >
                    {tx.type === "income" ? "+" : "−"}
                    {money(tx.amount, tx.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
