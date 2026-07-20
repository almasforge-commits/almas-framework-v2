function pickPrimaryCurrency(balances) {
  const keys = Object.keys(balances || {});
  if (keys.length === 0) return "VND";
  if (keys.includes("VND")) return "VND";
  if (keys.includes("RUB")) return "RUB";
  return keys[0];
}

export function mapFinanceSummary({
  balances,
  incomeMonth,
  expensesMonth,
  period,
  currency,
}) {
  const primary = currency || pickPrimaryCurrency(balances);
  const bucket = balances?.[primary] || { balance: 0, income: 0, expense: 0 };

  return {
    balance: Number(bucket.balance) || 0,
    incomeMonth: Number(incomeMonth) || 0,
    expensesMonth: Number(expensesMonth) || 0,
    currency: primary,
    period,
    demo: false,
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
