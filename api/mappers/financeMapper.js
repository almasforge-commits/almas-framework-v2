function pickPrimaryCurrency(balances) {
  const keys = Object.keys(balances || {});
  if (keys.length === 0) return "VND";
  if (keys.includes("VND")) return "VND";
  if (keys.includes("RUB")) return "RUB";
  return keys[0];
}

/**
 * @param {object} input
 */
export function mapFinanceSummary({
  balances,
  incomeMonth,
  expensesMonth,
  period,
  currency,
  baseCurrency,
  incomeBase,
  expenseBase,
  balanceBase,
  originalCurrencyTotals,
  fxStatus,
  ratesUpdatedAt,
}) {
  const primary = currency || pickPrimaryCurrency(balances);
  const bucket = balances?.[primary] || { balance: 0, income: 0, expense: 0 };
  const base = String(baseCurrency || primary || "VND").toUpperCase();

  const resolvedIncomeBase =
    incomeBase != null ? Number(incomeBase) : Number(incomeMonth) || 0;
  const resolvedExpenseBase =
    expenseBase != null ? Number(expenseBase) : Number(expensesMonth) || 0;
  const resolvedBalanceBase =
    balanceBase != null
      ? Number(balanceBase)
      : Number(bucket.balance) || resolvedIncomeBase - resolvedExpenseBase;

  const originals =
    Array.isArray(originalCurrencyTotals) && originalCurrencyTotals.length
      ? originalCurrencyTotals.map((row) => ({
          currency: String(row.currency || "VND").toUpperCase(),
          income: Number(row.income) || 0,
          expense: Number(row.expense) || 0,
        }))
      : Object.entries(balances || {}).map(([cur, b]) => ({
          currency: String(cur).toUpperCase(),
          income: Number(b.income) || 0,
          expense: Number(b.expense) || 0,
        }));

  return {
    // Legacy fields — when FX ok/partial these are base-currency totals.
    balance:
      fxStatus === "unavailable" && incomeBase == null
        ? Number(bucket.balance) || 0
        : resolvedBalanceBase || 0,
    incomeMonth:
      fxStatus === "unavailable" && incomeBase == null
        ? Number(incomeMonth) || 0
        : resolvedIncomeBase || 0,
    expensesMonth:
      fxStatus === "unavailable" && expenseBase == null
        ? Number(expensesMonth) || 0
        : resolvedExpenseBase || 0,
    currency: base,
    period,
    demo: false,
    // Multi-currency / FX fields
    baseCurrency: base,
    incomeBase: incomeBase == null ? null : resolvedIncomeBase,
    expenseBase: expenseBase == null ? null : resolvedExpenseBase,
    balanceBase: balanceBase == null ? null : resolvedBalanceBase,
    originalCurrencyTotals: originals,
    fxStatus: fxStatus || "ok",
    ratesUpdatedAt: ratesUpdatedAt || null,
  };
}

export function mapFinanceTransaction(row) {
  const created = row.created_at || row.date || null;
  let date = "";
  if (created) {
    try {
      date = new Date(created).toISOString().slice(0, 10);
    } catch {
      date = String(created).slice(0, 10);
    }
  }

  return {
    id: String(row.id ?? ""),
    type: row.type === "income" ? "income" : "expense",
    amount: Number(row.amount) || 0,
    currency: String(row.currency || "VND"),
    category: String(row.category || ""),
    description: String(row.description || ""),
    date,
  };
}

export function mapFinanceSettings({ baseCurrency, source }) {
  return {
    baseCurrency: String(baseCurrency || "VND").toUpperCase(),
    source: source || "default",
    convertible: true,
  };
}
