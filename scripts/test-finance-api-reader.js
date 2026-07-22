/**
 * Finance API reader / store — production 503 path coverage.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../api/createApp.js";
import { signInitDataForTests } from "../api/auth/validateInitData.js";
import { createFinanceReader } from "../api/readers/financeReader.js";
import {
  FINANCE_ERROR,
  FinanceStoreError,
  classifySupabaseFinanceError,
  sanitizeFinanceErrorMessage,
} from "../services/finance/financeStore.js";
import { mapFinanceSummary, mapFinanceTransaction } from "../api/mappers/financeMapper.js";
import { readSupabaseConfig, SUPABASE_ENV } from "../providers/storage/supabase.js";

const BOT = "finance-test-bot-token";

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((error) => {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function authFor(userId) {
  return `tma ${signInitDataForTests(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: userId, first_name: "U" }),
    },
    BOT
  )}`;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((r, j) => server.close((err) => (err ? j(err) : r()))),
      });
    });
  });
}

async function request(base, path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

function sampleExpense(userId, overrides = {}) {
  return {
    id: "tx-1",
    type: "expense",
    amount: 325000,
    currency: "VND",
    category: "Другое",
    description: "Finance API fix test",
    user_id: String(userId),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function run() {
  await test("1. env names are exactly SUPABASE_URL + SUPABASE_ANON_KEY", () => {
    assert.equal(SUPABASE_ENV.url, "SUPABASE_URL");
    assert.equal(SUPABASE_ENV.anonKey, "SUPABASE_ANON_KEY");
    const missing = readSupabaseConfig({
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "missing_url");
  });

  await test("2. missing supabase config fails safely via listRows", async () => {
    const logs = [];
    const reader = createFinanceReader({
      log: (l) => logs.push(String(l)),
      listRowsFn: async () => {
        throw new FinanceStoreError(
          FINANCE_ERROR.missing_supabase_config,
          "Supabase is not configured"
        );
      },
    });
    await assert.rejects(
      () => reader.getSummary({ userId: "1", telegramUserId: 1 }, "month"),
      (err) => {
        assert.equal(err.status, 503);
        assert.equal(err.logCode, "missing_supabase_config");
        return true;
      }
    );
    assert.ok(logs.some((l) => l.includes("errorCode=missing_supabase_config")));
  });

  await test("3–5. reader uses finance_transactions fields user_id + created_at", async () => {
    let seen = null;
    const reader = createFinanceReader({
      listRowsFn: async (userId, opts) => {
        seen = { userId, opts };
        return [];
      },
    });
    await reader.getSummary({ userId: "42", telegramUserId: 42 }, "month");
    assert.equal(seen.userId, "42");
    assert.ok(seen.opts.fromIso);
    assert.match(seen.opts.fromIso, /^\d{4}-\d{2}-\d{2}T/);
  });

  await test("6–7. empty summary/transactions return mapped zeros / []", async () => {
    const reader = createFinanceReader({
      listRowsFn: async () => [],
    });
    const summary = await reader.getSummary(
      { userId: "7", telegramUserId: 7 },
      "month"
    );
    assert.deepEqual(summary, {
      balance: 0,
      incomeMonth: 0,
      expensesMonth: 0,
      currency: "VND",
      period: "month",
      demo: false,
      baseCurrency: "VND",
      incomeBase: 0,
      expenseBase: 0,
      balanceBase: 0,
      originalCurrencyTotals: [],
      fxStatus: "ok",
      ratesUpdatedAt: null,
      ratesUsed: [],
    });
    const tx = await reader.getTransactions(
      { userId: "7", telegramUserId: 7 },
      { period: "month", limit: 20, offset: 0 }
    );
    assert.deepEqual(tx.items, []);
    assert.equal(tx.meta.hasMore, false);
  });

  await test("8–9. actor isolation: expense visible only to owner", async () => {
    const rowsByUser = {
      "10": [sampleExpense(10)],
      "11": [],
    };
    const reader = createFinanceReader({
      listRowsFn: async (userId) => rowsByUser[userId] || [],
    });
    const own = await reader.getTransactions(
      { userId: "10", telegramUserId: 10 },
      { period: "month" }
    );
    const other = await reader.getTransactions(
      { userId: "11", telegramUserId: 11 },
      { period: "month" }
    );
    assert.equal(own.items.length, 1);
    assert.equal(own.items[0].amount, 325000);
    assert.equal(other.items.length, 0);

    const summary = await reader.getSummary(
      { userId: "10", telegramUserId: 10 },
      "month"
    );
    assert.equal(summary.expensesMonth, 325000);
  });

  await test("10. month period applies fromIso filter", async () => {
    let fromIso = null;
    const reader = createFinanceReader({
      listRowsFn: async (_id, opts) => {
        fromIso = opts.fromIso;
        return [];
      },
    });
    await reader.getSummary({ userId: "1", telegramUserId: 1 }, "month");
    const ageMs = Date.now() - Date.parse(fromIso);
    assert.ok(ageMs >= 28 * 24 * 60 * 60 * 1000);
    assert.ok(ageMs <= 32 * 24 * 60 * 60 * 1000);
  });

  await test("11. invalid period returns 400 not 503", async () => {
    const app = createApp({
      botToken: BOT,
      financeReader: createFinanceReader({ listRowsFn: async () => [] }),
      inboxReader: { list: async () => ({ items: [], meta: {} }) },
      tasksReader: { list: async () => ({ items: [], meta: {} }) },
      knowledgeReader: { list: async () => ({ items: [], meta: {} }) },
      dashboardReader: { getHome: async () => ({ summary: {} }) },
      log: () => {},
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/finance/summary?period=year", {
        Authorization: authFor(1),
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "invalid_period");
    } finally {
      await close();
    }
  });

  await test("12–13. permission/column errors map to safe codes", () => {
    assert.equal(
      classifySupabaseFinanceError({
        code: "42501",
        message: "permission denied for table finance_transactions",
      }),
      FINANCE_ERROR.permission_denied
    );
    assert.equal(
      classifySupabaseFinanceError({
        code: "42703",
        message: 'column "created_on" does not exist',
      }),
      FINANCE_ERROR.column_not_found
    );
    assert.equal(
      classifySupabaseFinanceError({
        message: "Could not find the table 'public.finance_tx'",
      }),
      FINANCE_ERROR.table_not_found
    );
  });

  await test("14. mapper handles null optional fields", () => {
    const mapped = mapFinanceTransaction({
      id: 9,
      type: "expense",
      amount: null,
      currency: null,
      category: null,
      description: null,
      created_at: null,
    });
    assert.equal(mapped.amount, 0);
    assert.equal(mapped.currency, "VND");
    assert.equal(mapped.category, "");
    assert.equal(mapped.description, "");
    assert.equal(mapped.date, "");
    const summary = mapFinanceSummary({
      balances: {},
      incomeMonth: null,
      expensesMonth: undefined,
      period: "today",
      currency: null,
    });
    assert.equal(summary.balance, 0);
    assert.equal(summary.currency, "VND");
  });

  await test("15–16. finance endpoints return 200 with fixture rows", async () => {
    const logs = [];
    const reader = createFinanceReader({
      log: (l) => logs.push(String(l)),
      listRowsFn: async (userId) => {
        assert.equal(userId, "55");
        return [sampleExpense(55)];
      },
    });
    const app = createApp({
      botToken: BOT,
      financeReader: reader,
      inboxReader: { list: async () => ({ items: [], meta: {} }) },
      tasksReader: { list: async () => ({ items: [], meta: {} }) },
      knowledgeReader: { list: async () => ({ items: [], meta: {} }) },
      dashboardReader: { getHome: async () => ({ summary: {} }) },
      log: (l) => logs.push(String(l)),
    });
    const { base, close } = await listen(app);
    try {
      const summary = await request(base, "/api/finance/summary?period=month", {
        Authorization: authFor(55),
      });
      assert.equal(summary.status, 200);
      assert.equal(summary.body.data.expensesMonth, 325000);
      assert.equal(summary.body.data.demo, false);

      const tx = await request(
        base,
        "/api/finance/transactions?period=month&limit=10",
        { Authorization: authFor(55) }
      );
      assert.equal(tx.status, 200);
      assert.equal(tx.body.data.length, 1);
      assert.equal(tx.body.data[0].description, "Finance API fix test");
      assert.ok(logs.some((l) => l.includes("operation=summary")));
      assert.ok(logs.some((l) => l.includes("queryOk=true")));
    } finally {
      await close();
    }
  });

  await test("17. sanitizeFinanceErrorMessage strips urls/keys", () => {
    const cleaned = sanitizeFinanceErrorMessage(
      "fail https://ohnepqwrrkjfvnyememw.supabase.co/rest/v1/x supabase_anon_key=secret"
    );
    assert.ok(!cleaned.includes("https://"));
    assert.ok(!cleaned.includes("secret"));
  });

  await test("18. query_failed surfaces as 503 with diagnostics", async () => {
    const logs = [];
    const reader = createFinanceReader({
      log: (l) => logs.push(String(l)),
      listRowsFn: async () => {
        throw new FinanceStoreError(
          FINANCE_ERROR.query_failed,
          "Finance query failed",
          { details: "upstream boom" }
        );
      },
    });
    await assert.rejects(
      () =>
        reader.getTransactions({ userId: "1", telegramUserId: 1 }, {
          period: "week",
        }),
      (err) => err.logCode === "query_failed"
    );
    assert.ok(logs.some((l) => l.includes("errorCode=query_failed")));
  });

  if (process.exitCode) {
    console.error("\nfinance API reader tests failed.");
    process.exit(1);
  }
  console.log("\nAll finance API reader tests passed.");
}

run();
