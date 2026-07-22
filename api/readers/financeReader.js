import {
  mapFinanceSummary,
  mapFinanceTransaction,
  mapFinanceSettings,
} from "../mappers/financeMapper.js";
import { HttpError } from "../httpErrors.js";
import {
  FINANCE_ERROR,
  FinanceStoreError,
  getFinanceSupabaseStatus,
  listFinanceTransactionsForUser,
  sanitizeFinanceErrorMessage,
} from "../../services/finance/financeStore.js";
import { aggregateFinanceInBase } from "../../services/fx/aggregateFinance.js";
import { resolveBaseCurrency } from "../../services/fx/resolveBaseCurrency.js";
import { createFxProviderFromEnv } from "../../services/fx/fxProvider.js";

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

function logFinanceDiag(log, fields) {
  const logger = typeof log === "function" ? log : console.error;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    logger(`[finance-api] ${key}=${value}`);
  }
}

function toHttpError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof FinanceStoreError) {
    return new HttpError(
      error.status || 503,
      error.status === 401 ? "unauthorized" : "service_unavailable",
      error.status === 401 ? "Unauthorized" : "Finance unavailable",
      error.code
    );
  }
  const code = error?.code && FINANCE_ERROR[error.code]
    ? error.code
    : FINANCE_ERROR.unexpected_error;
  return new HttpError(503, "service_unavailable", "Finance unavailable", code);
}

/**
 * Actor-scoped finance reads against `finance_transactions`.
 * Always filters by user_id = String(telegramUserId) — same as Telegram writes.
 */
export function createFinanceReader(deps = {}) {
  const listRowsFn =
    typeof deps.listRowsFn === "function"
      ? deps.listRowsFn
      : listFinanceTransactionsForUser;
  const log = deps.log;
  const fxProvider =
    deps.fxProvider || createFxProviderFromEnv(deps.fxProviderOptions || {});
  const resolveBaseCurrencyFn =
    deps.resolveBaseCurrencyFn || resolveBaseCurrency;
  const getBaseCurrencyPreferenceFn = deps.getBaseCurrencyPreferenceFn;

  const getBalanceFn = deps.getBalanceFn;
  const getHistoryFn = deps.getHistoryFn;
  const getExpensesByPeriodFn = deps.getExpensesByPeriodFn;
  const getStatisticsFn = deps.getStatisticsFn;
  const useLegacy =
    Boolean(deps.forceLegacy) ||
    (typeof deps.getHistoryFn === "function" &&
      typeof deps.listRowsFn !== "function");

  function requireUserId(actor) {
    const userId = actor?.userId || String(actor?.telegramUserId || "");
    if (!userId || userId === "undefined" || userId === "null") {
      throw new HttpError(401, "unauthorized", "Unauthorized", FINANCE_ERROR.invalid_actor);
    }
    return String(userId);
  }

  async function loadRows(userId, period, limit) {
    const from = startOfPeriod(period);
    if (useLegacy) {
      const history = (await getHistoryFn(userId, limit)) || [];
      if (!Array.isArray(history)) return [];
      return history.filter((row) => {
        const created = row?.created_at ? new Date(row.created_at) : null;
        return created && !Number.isNaN(created.getTime()) && created >= from;
      });
    }
    return listRowsFn(userId, {
      fromIso: from.toISOString(),
      limit,
    });
  }

  async function summarize(rows, period, actor) {
    try {
      const balances = {};
      for (const row of rows) {
        const currency = String(row.currency || "VND");
        if (!balances[currency]) {
          balances[currency] = { income: 0, expense: 0, balance: 0 };
        }
        const amount = Number(row.amount) || 0;
        if (row.type === "income") balances[currency].income += amount;
        if (row.type === "expense") balances[currency].expense += amount;
        balances[currency].balance =
          balances[currency].income - balances[currency].expense;
      }

      const baseCurrency = await resolveBaseCurrencyFn(actor, {
        getPreferenceFn: getBaseCurrencyPreferenceFn,
        profileBaseCurrency: deps.profileBaseCurrency,
      });

      const fx = await aggregateFinanceInBase(rows, {
        baseCurrency,
        getRate: (from, to, at) => fxProvider.getRate(from, to, at),
        log: (line) => {
          if (typeof log === "function") log(line);
          else console.error(line);
        },
      });

      let incomeMonth = 0;
      let expensesMonth = 0;
      const legacyCurrency = balances[baseCurrency]
        ? baseCurrency
        : Object.keys(balances)[0] || baseCurrency;
      for (const row of rows) {
        if (String(row.currency || "VND") !== legacyCurrency) continue;
        if (row.type === "income") incomeMonth += Number(row.amount) || 0;
        if (row.type === "expense") expensesMonth += Number(row.amount) || 0;
      }

      return mapFinanceSummary({
        balances,
        incomeMonth:
          fx.fxStatus === "unavailable" ? incomeMonth : fx.incomeBase ?? incomeMonth,
        expensesMonth:
          fx.fxStatus === "unavailable"
            ? expensesMonth
            : fx.expenseBase ?? expensesMonth,
        period,
        currency: baseCurrency,
        baseCurrency: fx.baseCurrency,
        incomeBase: fx.incomeBase,
        expenseBase: fx.expenseBase,
        balanceBase: fx.balanceBase,
        originalCurrencyTotals: fx.originalCurrencyTotals,
        fxStatus: fx.fxStatus,
        ratesUpdatedAt: fx.ratesUpdatedAt,
        ratesUsed: fx.ratesUsed,
      });
    } catch (error) {
      throw new FinanceStoreError(
        FINANCE_ERROR.mapper_failed,
        "Finance mapper failed",
        { details: error?.message }
      );
    }
  }

  return {
    async getSettings(actor) {
      const baseCurrency = await resolveBaseCurrencyFn(actor, {
        getPreferenceFn: getBaseCurrencyPreferenceFn,
        profileBaseCurrency: deps.profileBaseCurrency,
      });
      return mapFinanceSettings({
        baseCurrency,
        source: getBaseCurrencyPreferenceFn ? "preference_or_default" : "default",
      });
    },

    async getSummary(actor, period = "month") {
      const status = getFinanceSupabaseStatus();
      let userId = null;
      try {
        userId = requireUserId(actor);
        logFinanceDiag(log, {
          operation: "summary",
          actorUserIdPresent: true,
          period: String(period),
          supabaseConfigured:
            status.urlPresent && status.keyPresent ? "true" : "false",
          clientCreated: status.clientCreated ? "true" : "false",
          reasonCode: status.reasonCode || "none",
          queryStarted: true,
        });

        if (useLegacy) {
          const days = periodToDays(period);
          const expensesByCurrency =
            (await getExpensesByPeriodFn(userId, days)) || {};
          const stats =
            (await getStatisticsFn(userId)) || { incomes: {}, expenses: {} };
          const history = (await getHistoryFn(userId, 200)) || [];
          const from = startOfPeriod(period);
          const inPeriod = (Array.isArray(history) ? history : []).filter(
            (row) => {
              const created = row?.created_at ? new Date(row.created_at) : null;
              return (
                created && !Number.isNaN(created.getTime()) && created >= from
              );
            }
          );
          const summaryRows =
            inPeriod.length > 0
              ? inPeriod
              : [
                  ...Object.entries(expensesByCurrency).map(([currency, amount]) => ({
                    type: "expense",
                    amount: Number(amount) || 0,
                    currency,
                  })),
                  ...Object.entries(stats.incomes || {}).map(([currency, amount]) => ({
                    type: "income",
                    amount:
                      period === "today"
                        ? 0
                        : period === "week"
                          ? Math.round((Number(amount) || 0) * (7 / 30))
                          : Number(amount) || 0,
                    currency,
                  })),
                ];
          const summary = await summarize(summaryRows, period, actor);
          logFinanceDiag(log, {
            operation: "summary",
            queryOk: true,
            rowCount: summaryRows.length,
            errorCode: "none",
          });
          return summary;
        }

        const rows = await loadRows(userId, period, 500);
        const summary = await summarize(rows, period, actor);
        logFinanceDiag(log, {
          operation: "summary",
          queryOk: true,
          rowCount: rows.length,
          errorCode: "none",
        });
        return summary;
      } catch (error) {
        const httpError = toHttpError(error);
        logFinanceDiag(log, {
          operation: "summary",
          actorUserIdPresent: Boolean(userId),
          period: String(period),
          supabaseConfigured:
            status.urlPresent && status.keyPresent ? "true" : "false",
          queryStarted: true,
          queryOk: false,
          rowCount: 0,
          errorCode: httpError.logCode || FINANCE_ERROR.unexpected_error,
          errorMessage: sanitizeFinanceErrorMessage(
            error?.details || error?.message || httpError.message
          ),
        });
        throw httpError;
      }
    },

    async getTransactions(
      actor,
      { period = "month", limit = 20, offset = 0 } = {}
    ) {
      const status = getFinanceSupabaseStatus();
      let userId = null;
      try {
        userId = requireUserId(actor);
        logFinanceDiag(log, {
          operation: "transactions",
          actorUserIdPresent: true,
          period: String(period),
          limit: Number(limit) || 20,
          supabaseConfigured:
            status.urlPresent && status.keyPresent ? "true" : "false",
          clientCreated: status.clientCreated ? "true" : "false",
          reasonCode: status.reasonCode || "none",
          queryStarted: true,
        });

        const fetchLimit = Math.min(offset + limit + 1, 200);
        const filtered = await loadRows(userId, period, fetchLimit);
        const page = filtered.slice(offset, offset + limit + 1);
        const hasMore = page.length > limit;
        let items;
        try {
          items = (hasMore ? page.slice(0, limit) : page).map(
            mapFinanceTransaction
          );
        } catch (error) {
          throw new FinanceStoreError(
            FINANCE_ERROR.mapper_failed,
            "Finance mapper failed",
            { details: error?.message }
          );
        }

        logFinanceDiag(log, {
          operation: "transactions",
          queryOk: true,
          rowCount: filtered.length,
          errorCode: "none",
        });

        return {
          items,
          meta: { limit, offset, hasMore },
        };
      } catch (error) {
        const httpError = toHttpError(error);
        logFinanceDiag(log, {
          operation: "transactions",
          actorUserIdPresent: Boolean(userId),
          period: String(period),
          limit: Number(limit) || 20,
          supabaseConfigured:
            status.urlPresent && status.keyPresent ? "true" : "false",
          queryStarted: true,
          queryOk: false,
          rowCount: 0,
          errorCode: httpError.logCode || FINANCE_ERROR.unexpected_error,
          errorMessage: sanitizeFinanceErrorMessage(
            error?.details || error?.message || httpError.message
          ),
        });
        throw httpError;
      }
    },
  };
}
