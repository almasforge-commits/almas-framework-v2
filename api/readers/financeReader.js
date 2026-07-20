import { mapFinanceSummary, mapFinanceTransaction } from "../mappers/financeMapper.js";
import { HttpError } from "../httpErrors.js";

function periodToDays(period) {
  if (period === "today") return 1;
  if (period === "week") return 7;
  return 30;
}

function startOfPeriod(period, now = new Date()) {
  const d = new Date(now);
  if (period === "today") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "week") {
    d.setDate(d.getDate() - 7);
    return d;
  }
  d.setDate(d.getDate() - 30);
  return d;
}

/**
 * Actor-scoped finance reads. Never uses unscoped getTransactions().
 * Always filters by user_id = String(telegramUserId).
 */
export function createFinanceReader(deps = {}) {
  const getBalanceFn = deps.getBalanceFn;
  const getHistoryFn = deps.getHistoryFn;
  const getExpensesByPeriodFn = deps.getExpensesByPeriodFn;
  const getStatisticsFn = deps.getStatisticsFn;

  function requireUserId(actor) {
    const userId = actor?.userId || String(actor?.telegramUserId || "");
    if (!userId || userId === "undefined" || userId === "null") {
      throw new HttpError(401, "unauthorized", "Unauthorized", "missing_actor");
    }
    return userId;
  }

  return {
    async getSummary(actor, period = "month") {
      const userId = requireUserId(actor);
      try {
        const balances = (await getBalanceFn(userId)) || {};
        const days = periodToDays(period);
        const expensesByCurrency =
          (await getExpensesByPeriodFn(userId, days)) || {};
        const stats =
          (await getStatisticsFn(userId)) || { incomes: {}, expenses: {} };
        const currency =
          Object.keys(balances)[0] ||
          Object.keys(expensesByCurrency)[0] ||
          "VND";

        const history = (await getHistoryFn(userId, 200)) || [];
        const from = startOfPeriod(period);
        const inPeriod = history.filter((row) => {
          const created = row.created_at ? new Date(row.created_at) : null;
          return created && created >= from;
        });

        let incomeMonth = 0;
        let expensesMonth = 0;
        for (const row of inPeriod) {
          if (row.currency && row.currency !== currency) continue;
          if (row.type === "income") incomeMonth += Number(row.amount) || 0;
          if (row.type === "expense") expensesMonth += Number(row.amount) || 0;
        }

        if (inPeriod.length === 0) {
          expensesMonth = Number(expensesByCurrency[currency]) || 0;
          incomeMonth = Number(stats.incomes?.[currency]) || 0;
          if (period === "today") incomeMonth = 0;
          if (period === "week") {
            incomeMonth = Math.round(incomeMonth * (7 / 30));
          }
        }

        return mapFinanceSummary({
          balances,
          incomeMonth,
          expensesMonth,
          period,
          currency,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "service_unavailable",
          "Finance unavailable",
          "finance_summary_failed"
        );
      }
    },

    async getTransactions(actor, { period = "month", limit = 20, offset = 0 } = {}) {
      const userId = requireUserId(actor);
      try {
        const fetchLimit = Math.min(offset + limit + 1, 200);
        const history = (await getHistoryFn(userId, fetchLimit)) || [];
        const from = startOfPeriod(period);
        const filtered = history.filter((row) => {
          const created = row.created_at ? new Date(row.created_at) : null;
          return created && created >= from;
        });
        const page = filtered.slice(offset, offset + limit + 1);
        const hasMore = page.length > limit;
        const items = (hasMore ? page.slice(0, limit) : page).map(
          mapFinanceTransaction
        );
        return {
          items,
          meta: { limit, offset, hasMore },
        };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "service_unavailable",
          "Finance unavailable",
          "finance_transactions_failed"
        );
      }
    },
  };
}
