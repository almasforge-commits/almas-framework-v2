/**
 * Multi-currency FX aggregation — no live network.
 */

import assert from "node:assert/strict";
import { aggregateFinanceInBase } from "../services/fx/aggregateFinance.js";
import {
  clearFxCache,
  getCachedFxRate,
  makeFxCacheKey,
} from "../services/fx/fxCache.js";
import {
  convertMoney,
  createFxProviderFromEnv,
  createNoneFxProvider,
  createTestFxProvider,
  withFxCache,
} from "../services/fx/fxProvider.js";
import { resolveBaseCurrency, DEFAULT_BASE_CURRENCY } from "../services/fx/resolveBaseCurrency.js";
import { createFinanceReader } from "../api/readers/financeReader.js";
import { mapFinanceSummary } from "../api/mappers/financeMapper.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err);
    failed += 1;
  }
}

await test("23: KZT 30000 + USD 100 → one KZT total", async () => {
  clearFxCache();
  const provider = createTestFxProvider({ "USD:KZT": 450 });
  const fx = await aggregateFinanceInBase(
    [
      { type: "income", amount: 30000, currency: "KZT" },
      { type: "income", amount: 100, currency: "USD" },
    ],
    {
      baseCurrency: "KZT",
      getRate: (from, to, at) => provider.getRate(from, to, at),
    }
  );
  assert.equal(fx.fxStatus, "ok");
  assert.equal(fx.incomeBase, 30000 + 100 * 450);
  assert.equal(fx.originalCurrencyTotals.length, 2);
});

await test("24: originals unchanged on DTO", async () => {
  const provider = createTestFxProvider({ "USD:KZT": 450 });
  const rows = [
    { type: "income", amount: 100, currency: "USD" },
    { type: "income", amount: 30000, currency: "KZT" },
  ];
  const fx = await aggregateFinanceInBase(rows, {
    baseCurrency: "KZT",
    getRate: (f, t, a) => provider.getRate(f, t, a),
  });
  assert.deepEqual(
    fx.originalCurrencyTotals.find((x) => x.currency === "USD"),
    { currency: "USD", income: 100, expense: 0 }
  );
  assert.equal(rows[0].amount, 100);
  assert.equal(rows[0].currency, "USD");
});

await test("25: VND+USD+KZT into selected base", async () => {
  const provider = createTestFxProvider({
    "USD:KZT": 450,
    "VND:KZT": 0.018,
  });
  const fx = await aggregateFinanceInBase(
    [
      { type: "expense", amount: 100000, currency: "VND" },
      { type: "expense", amount: 10, currency: "USD" },
      { type: "expense", amount: 5000, currency: "KZT" },
    ],
    {
      baseCurrency: "KZT",
      getRate: (f, t, a) => provider.getRate(f, t, a),
    }
  );
  assert.equal(fx.fxStatus, "ok");
  assert.ok(fx.expenseBase > 5000);
});

await test("26: missing one rate → partial", async () => {
  const provider = createTestFxProvider({ "USD:KZT": 450 });
  const fx = await aggregateFinanceInBase(
    [
      { type: "income", amount: 100, currency: "USD" },
      { type: "income", amount: 50, currency: "EUR" },
      { type: "income", amount: 1000, currency: "KZT" },
    ],
    {
      baseCurrency: "KZT",
      getRate: (f, t, a) => provider.getRate(f, t, a),
    }
  );
  assert.equal(fx.fxStatus, "partial");
  assert.equal(fx.incomeBase, 1000 + 45000);
});

await test("27: no rates → unavailable", async () => {
  const provider = createNoneFxProvider();
  const fx = await aggregateFinanceInBase(
    [
      { type: "income", amount: 100, currency: "USD" },
      { type: "income", amount: 30000, currency: "KZT" },
    ],
    {
      baseCurrency: "VND",
      getRate: (f, t, a) => provider.getRate(f, t, a),
    }
  );
  assert.equal(fx.fxStatus, "unavailable");
  assert.equal(fx.incomeBase, null);
});

await test("28: one-currency summary without conversion", async () => {
  const provider = createNoneFxProvider();
  const fx = await aggregateFinanceInBase(
    [{ type: "expense", amount: 75000, currency: "VND" }],
    {
      baseCurrency: "VND",
      getRate: (f, t, a) => provider.getRate(f, t, a),
    }
  );
  assert.equal(fx.fxStatus, "ok");
  assert.equal(fx.expenseBase, 75000);
});

await test("29: cross-actor base currency isolation", async () => {
  const a = await resolveBaseCurrency(
    { actorKey: "tg:1" },
    { getPreferenceFn: async () => "KZT" }
  );
  const b = await resolveBaseCurrency(
    { actorKey: "tg:2" },
    { getPreferenceFn: async () => "USD" }
  );
  assert.equal(a, "KZT");
  assert.equal(b, "USD");
  assert.equal(DEFAULT_BASE_CURRENCY, "VND");
});

await test("30: FX cache reused", async () => {
  clearFxCache();
  let calls = 0;
  const inner = {
    name: "count",
    async getRate(from, to, at) {
      calls += 1;
      return {
        rate: 450,
        source: "count",
        baseCurrency: from,
        quoteCurrency: to,
        fetchedAt: new Date().toISOString(),
        effectiveAt: new Date().toISOString(),
      };
    },
  };
  const provider = withFxCache(inner);
  await provider.getRate("USD", "KZT");
  await provider.getRate("USD", "KZT");
  assert.equal(calls, 1);
  const key = makeFxCacheKey("count", "USD", "KZT", new Date());
  assert.ok(getCachedFxRate(key));
});

await test("31-32: Dashboard/Finance DTO fields", async () => {
  const dto = mapFinanceSummary({
    balances: { KZT: { income: 30000, expense: 0, balance: 30000 } },
    incomeMonth: 75000,
    expensesMonth: 0,
    period: "today",
    currency: "KZT",
    baseCurrency: "KZT",
    incomeBase: 75000,
    expenseBase: 0,
    balanceBase: 75000,
    originalCurrencyTotals: [
      { currency: "KZT", income: 30000, expense: 0 },
      { currency: "USD", income: 100, expense: 0 },
    ],
    fxStatus: "ok",
    ratesUpdatedAt: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(dto.baseCurrency, "KZT");
  assert.equal(dto.fxStatus, "ok");
  assert.equal(dto.originalCurrencyTotals.length, 2);
  assert.equal(dto.incomeBase, 75000);
});

await test("33: finance reader uses test provider without network", async () => {
  clearFxCache();
  const reader = createFinanceReader({
    listRowsFn: async () => [
      {
        id: 1,
        type: "income",
        amount: 30000,
        currency: "KZT",
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        type: "income",
        amount: 100,
        currency: "USD",
        created_at: new Date().toISOString(),
      },
    ],
    fxProvider: createTestFxProvider({ "USD:KZT": 450 }),
    resolveBaseCurrencyFn: async () => "KZT",
    log: () => {},
  });
  const summary = await reader.getSummary(
    { telegramUserId: "42", userId: "42", actorKey: "tg:42" },
    "today"
  );
  assert.equal(summary.baseCurrency, "KZT");
  assert.equal(summary.fxStatus, "ok");
  assert.equal(summary.incomeBase, 75000);
  assert.equal(summary.originalCurrencyTotals.length, 2);
});

await test("convertMoney helper", async () => {
  const provider = createTestFxProvider({ "USD:KZT": 450 });
  const result = await convertMoney({
    amount: 100,
    from: "USD",
    to: "KZT",
    provider,
  });
  assert.equal(result.amount, 45000);
  assert.equal(result.fxStatus, "ok");
});

await test("createFxProviderFromEnv none is default-safe", async () => {
  const provider = createFxProviderFromEnv({ provider: "none" });
  assert.equal(await provider.getRate("USD", "KZT"), null);
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed ? 1 : 0);
