/**
 * FX conversion layer — summaries/analytics only.
 * Original finance transactions are never mutated.
 *
 * Policy (HISTORICAL VS CURRENT):
 * - Dashboard / current-period summaries use the latest cached rate.
 * - Historical reports should use the closest rate effective_at <= transaction date
 *   when the provider/cache supports dated rates.
 * - Analytics may record ratesUsed[] on the summary DTO when useful.
 *
 * Default base currency: VND (FINANCE_DEFAULT_BASE_CURRENCY / FX_DEFAULT_BASE_CURRENCY).
 */

/** @typedef {"ok"|"partial"|"unavailable"} FxStatus */

/**
 * @param {object} input
 * @param {number} input.amount
 * @param {string} input.from
 * @param {string} input.to
 * @param {number|null} input.rate
 * @returns {{ amount: number|null, converted: boolean }}
 */
export function applyRate({ amount, from, to, rate }) {
  const value = Number(amount);
  const src = String(from || "").toUpperCase();
  const dst = String(to || "").toUpperCase();
  if (!Number.isFinite(value)) return { amount: null, converted: false };
  if (src === dst) return { amount: value, converted: true };
  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) {
    return { amount: null, converted: false };
  }
  return { amount: value * Number(rate), converted: true };
}

/**
 * Aggregate multi-currency rows into a base-currency summary.
 * Never treats distinct currencies as equal without a rate.
 *
 * @param {object[]} rows - { amount, currency, type }
 * @param {object} options
 * @param {string} options.baseCurrency
 * @param {(from: string, to: string, at?: Date) => Promise<{ rate: number, source: string, fetchedAt: string, effectiveAt: string }|null>} options.getRate
 * @param {Date} [options.rateDate]
 * @param {(line: string) => void} [options.log]
 */
export async function aggregateFinanceInBase(rows, options) {
  const baseCurrency = String(options.baseCurrency || "VND").toUpperCase();
  const getRate = options.getRate;
  const rateDate = options.rateDate || new Date();
  const log = typeof options.log === "function" ? options.log : null;

  const originals = new Map();
  for (const row of rows || []) {
    const currency = String(row.currency || "VND").toUpperCase();
    if (!originals.has(currency)) {
      originals.set(currency, { currency, income: 0, expense: 0 });
    }
    const bucket = originals.get(currency);
    const amount = Number(row.amount) || 0;
    if (row.type === "income") bucket.income += amount;
    if (row.type === "expense") bucket.expense += amount;
  }

  const originalCurrencyTotals = [...originals.values()];
  const currencies = originalCurrencyTotals.map((x) => x.currency);

  let incomeBase = 0;
  let expenseBase = 0;
  let convertible = 0;
  let failed = 0;
  let ratesUpdatedAt = null;
  const ratesUsed = [];
  let cacheHits = 0;

  for (const bucket of originalCurrencyTotals) {
    if (bucket.currency === baseCurrency) {
      incomeBase += bucket.income;
      expenseBase += bucket.expense;
      convertible += 1;
      continue;
    }

    const quote = await getRate(bucket.currency, baseCurrency, rateDate);
    if (!quote || !Number.isFinite(Number(quote.rate)) || Number(quote.rate) <= 0) {
      failed += 1;
      continue;
    }
    if (quote.cacheHit) cacheHits += 1;
    convertible += 1;
    ratesUsed.push({
      from: bucket.currency,
      to: baseCurrency,
      rate: Number(quote.rate),
      source: quote.source,
      fetchedAt: quote.fetchedAt,
      effectiveAt: quote.effectiveAt,
    });
    if (quote.fetchedAt) {
      ratesUpdatedAt = quote.fetchedAt;
    }
    incomeBase += bucket.income * Number(quote.rate);
    expenseBase += bucket.expense * Number(quote.rate);
  }

  /** @type {FxStatus} */
  let fxStatus = "ok";
  if (currencies.length <= 1 || currencies.every((c) => c === baseCurrency)) {
    fxStatus = "ok";
  } else if (failed > 0 && convertible > 0) {
    fxStatus = "partial";
  } else if (failed > 0 && convertible === 0) {
    fxStatus = "unavailable";
    incomeBase = null;
    expenseBase = null;
  } else if (failed > 0) {
    fxStatus = "partial";
  }

  // Single foreign currency with no rate and no base rows.
  if (
    currencies.length >= 1 &&
    !currencies.includes(baseCurrency) &&
    failed === currencies.length
  ) {
    fxStatus = "unavailable";
    incomeBase = null;
    expenseBase = null;
  }

  if (log) {
    log(`[fx] baseCurrency=${baseCurrency}`);
    log(`[fx] currencies=${currencies.join(",") || "none"}`);
    log(`[fx] status=${fxStatus}`);
    log(`[fx] rateCount=${ratesUsed.length}`);
    log(`[fx] cacheHit=${cacheHits > 0}`);
  }

  const balanceBase =
    incomeBase == null || expenseBase == null
      ? null
      : incomeBase - expenseBase;

  return {
    baseCurrency,
    incomeBase,
    expenseBase,
    balanceBase,
    originalCurrencyTotals,
    fxStatus,
    ratesUpdatedAt,
    ratesUsed,
  };
}
