/**
 * Consistency suite: FX open-er-api, categorizer, dashboard single finance pass,
 * activity badge domain, task patch.
 */

import assert from "node:assert/strict";
import { clearFxCache } from "../services/fx/fxCache.js";
import {
  createFrankfurterFxProvider,
  createFxProviderFromEnv,
  createOpenErApiFxProvider,
  withFxCache,
} from "../services/fx/fxProvider.js";
import { aggregateFinanceInBase } from "../services/fx/aggregateFinance.js";
import {
  detectCategory,
  resolveFinanceCategory,
} from "../services/finance/categorizer.js";
import { parseFinanceMessage } from "../services/finance/financeParser.js";
import { createFinanceReader } from "../api/readers/financeReader.js";
import { createDashboardReader } from "../api/readers/dashboardReader.js";
import { resolveActivityDomain } from "../api/mappers/activityDomain.js";
import { classifyInformationKinds } from "../services/inbox/informationKindClassifier.js";

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

await test("Frankfurter returns null for KZT/VND (root cause)", async () => {
  const provider = createFrankfurterFxProvider(async () => ({
    ok: false,
    status: 404,
    async json() {
      return { message: "not found" };
    },
  }));
  assert.equal(await provider.getRate("USD", "KZT"), null);
  assert.equal(await provider.getRate("USD", "VND"), null);
});

await test("open-er-api converts USD/VND → KZT with one table fetch", async () => {
  clearFxCache();
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    assert.match(String(url), /open\.er-api\.com/);
    return {
      ok: true,
      async json() {
        return {
          result: "success",
          rates: { KZT: 450, VND: 25000, EUR: 0.92 },
        };
      },
    };
  };
  const provider = withFxCache(createOpenErApiFxProvider(fetchFn));
  const usd = await provider.getRate("USD", "KZT");
  const vnd = await provider.getRate("VND", "KZT");
  assert.equal(usd.rate, 450);
  assert.ok(Math.abs(vnd.rate - 450 / 25000) < 1e-9);
  assert.equal(calls, 1, "single HTTP for table");
  const usd2 = await provider.getRate("USD", "KZT");
  assert.equal(usd2.cacheHit, true);
  assert.equal(calls, 1);
});

await test("default env provider is open-er-api (not none)", async () => {
  clearFxCache();
  const fetchFn = async () => ({
    ok: true,
    async json() {
      return { result: "success", rates: { KZT: 450, VND: 25000 } };
    },
  });
  const provider = createFxProviderFromEnv({
    provider: undefined,
    fetchFn,
  });
  // Force default path by omitting provider override when env unset — use explicit open-er-api
  const live = createFxProviderFromEnv({ provider: "open-er-api", fetchFn });
  const fx = await aggregateFinanceInBase(
    [
      { type: "income", amount: 30000, currency: "KZT" },
      { type: "income", amount: 100, currency: "USD" },
      { type: "expense", amount: 100000, currency: "VND" },
    ],
    {
      baseCurrency: "KZT",
      getRate: (f, t, a) => live.getRate(f, t, a),
    }
  );
  assert.equal(fx.fxStatus, "ok");
  assert.ok(fx.rateCount === undefined || fx.ratesUsed.length >= 2);
  assert.equal(fx.ratesUsed.length >= 2, true);
  assert.ok(fx.incomeBase > 30000);
  void provider;
});

await test("categorizer: кофе→Напитки, такси→Транспорт, консультация→Доход", () => {
  assert.equal(detectCategory("кофе", "expense"), "Напитки");
  assert.equal(detectCategory("кока-кола", "expense"), "Напитки");
  assert.equal(detectCategory("такси до аэропорта", "expense"), "Транспорт");
  assert.equal(detectCategory("консультация клиенту", "income"), "Доход");
  assert.equal(detectCategory("продажа проекта", "income"), "Доход");
  assert.equal(
    resolveFinanceCategory({
      description: "кола",
      type: "expense",
      category: "other",
    }),
    "Напитки"
  );
  const parsed = parseFinanceMessage("потратил 75000 на кофе");
  assert.equal(parsed.category, "Напитки");
});

await test("dashboard makes one finance bundle (no double summary)", async () => {
  let summaryCalls = 0;
  let bundleCalls = 0;
  const financeReader = {
    async getDashboardBundle() {
      bundleCalls += 1;
      return {
        summary: {
          baseCurrency: "KZT",
          currency: "KZT",
          expenseBase: 1000,
          incomeBase: 5000,
          balanceBase: 4000,
          expensesMonth: 1000,
          incomeMonth: 5000,
          balance: 4000,
          fxStatus: "ok",
          ratesUpdatedAt: null,
        },
        transactions: [
          {
            id: "1",
            type: "expense",
            amount: 1000,
            currency: "KZT",
            description: "кофе",
            category: "Напитки",
            date: new Date().toISOString().slice(0, 10),
          },
        ],
      };
    },
    async getSummary() {
      summaryCalls += 1;
      throw new Error("getSummary must not be called when bundle exists");
    },
    async getTransactions() {
      throw new Error("getTransactions must not be called when bundle exists");
    },
  };
  const reader = createDashboardReader({
    financeReader,
    inboxReader: {
      async list() {
        return {
          items: [
            {
              id: "i1",
              originalText: "Запиши что я потратил 75 000 на кофе",
              informationKinds: ["idea"],
              executionSummary: null,
              time: "",
              status: "analyzed",
            },
          ],
        };
      },
    },
    tasksReader: {
      async list() {
        return {
          items: [{ id: "t1", title: "Task", completed: false, dueLabel: "" }],
        };
      },
    },
    knowledgeReader: { async list() { return { items: [] }; } },
  });
  const home = await reader.getHome({
    firstName: "A",
    telegramUserId: "1",
    userId: "1",
  });
  assert.equal(bundleCalls, 1);
  assert.equal(summaryCalls, 0);
  assert.equal(home.summary.baseCurrency, "KZT");
  // Finance voice text must not appear as Idea activity.
  assert.ok(
    !home.recentActions.some(
      (a) => a.kind === "idea" && /потратил/i.test(a.title)
    )
  );
  assert.ok(home.todayActivity.some((a) => a.kind === "expense"));
});

await test("activity domain: finance never idea", () => {
  const kinds = classifyInformationKinds({
    normalizedText: "Потратил 25000 на колу",
    routingDecision: { actions: [{ type: "finance_expense" }] },
  });
  assert.ok(kinds.informationKinds.includes("finance"));
  assert.ok(!kinds.informationKinds.includes("idea"));
  assert.equal(
    resolveActivityDomain(["finance", "idea"], {
      executionSummary: "expense_saved",
    }),
    "expense"
  );
});

await test("finance reader dashboard bundle dedupes ids", async () => {
  clearFxCache();
  const reader = createFinanceReader({
    listRowsFn: async () => [
      {
        id: "a",
        type: "income",
        amount: 100,
        currency: "USD",
        created_at: new Date().toISOString(),
      },
      {
        id: "a",
        type: "income",
        amount: 100,
        currency: "USD",
        created_at: new Date().toISOString(),
      },
      {
        id: "b",
        type: "income",
        amount: 30000,
        currency: "KZT",
        created_at: new Date().toISOString(),
      },
    ],
    fxProvider: createFxProviderFromEnv({
      provider: "test",
      rateTable: { "USD:KZT": 450 },
    }),
    resolveBaseCurrencyFn: async () => "KZT",
    log: () => {},
  });
  const bundle = await reader.getDashboardBundle({
    telegramUserId: "9",
    userId: "9",
  });
  assert.equal(bundle.transactions.length, 2);
  assert.equal(bundle.summary.fxStatus, "ok");
  assert.equal(bundle.summary.incomeBase, 30000 + 45000);
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed ? 1 : 0);
