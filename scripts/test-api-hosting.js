/**
 * API hosting readiness: PORT, bind host, health, CORS.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../api/createApp.js";
import { resolveListenConfig } from "../api/server.js";
import { parseCorsAllowlist, resolveCorsOrigin } from "../api/cors.js";
import { createFinanceReader } from "../api/readers/financeReader.js";
import { createInboxReader } from "../api/readers/inboxReader.js";
import { createTasksReader } from "../api/readers/tasksReader.js";
import { createKnowledgeReader } from "../api/readers/knowledgeReader.js";
import { createDashboardReader } from "../api/readers/dashboardReader.js";
import { signInitDataForTests } from "../api/auth/validateInitData.js";
import { createCaptureSessionStore } from "../services/capture/captureSessionStore.js";
import { createCaptureReader } from "../api/readers/captureReader.js";
import { listTasksForActor } from "../services/storage/listTasksForActor.js";

const BOT = "hosting-test-token";
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

function listen(app, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, host, () => {
      const addr = server.address();
      resolve({
        base: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise((r, j) => server.close((err) => (err ? j(err) : r()))),
      });
    });
  });
}

function minimalApp(extra = {}) {
  const financeReader = createFinanceReader({
    getBalanceFn: async () => ({}),
    getHistoryFn: async () => [],
    getExpensesByPeriodFn: async () => ({}),
    getStatisticsFn: async () => ({ incomes: {}, expenses: {} }),
  });
  const inboxReader = createInboxReader({ listInboxItemsFn: async () => [] });
  const tasksReader = createTasksReader({
    listTasksForUserFn: async () => [
      {
        id: "t1",
        content: "Купить молоко",
        metadata: { memoryType: "task", status: "active", userId: "42" },
      },
    ],
  });
  const knowledgeReader = createKnowledgeReader({});
  return createApp({
    botToken: BOT,
    financeReader,
    inboxReader,
    tasksReader,
    knowledgeReader,
    dashboardReader: createDashboardReader({
      financeReader,
      inboxReader,
      tasksReader,
      knowledgeReader,
    }),
    corsAllowlist: parseCorsAllowlist(
      "https://almas-framework-v2-five.vercel.app"
    ),
    log: () => {},
    ...extra,
  });
}

await test("7. API honors hosted PORT via resolveListenConfig", () => {
  const local = resolveListenConfig({ ALMAS_API_PORT: "9001" });
  assert.equal(local.port, 9001);
  assert.equal(local.host, "127.0.0.1");

  const hosted = resolveListenConfig({ PORT: "3000" });
  assert.equal(hosted.port, 3000);
  assert.equal(hosted.host, "0.0.0.0");
  assert.equal(hosted.hosted, true);
});

await test("8. API binds 0.0.0.0 when PORT is set (config)", () => {
  const cfg = resolveListenConfig({
    PORT: "8080",
    RAILWAY_ENVIRONMENT: "production",
  });
  assert.equal(cfg.host, "0.0.0.0");
  assert.equal(cfg.port, 8080);
});

await test("9. GET /health and /api/health succeed", async () => {
  const app = minimalApp();
  const { base, close } = await listen(app);
  try {
    for (const path of ["/health", "/api/health"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.ok, true);
    }
  } finally {
    await close();
  }
});

await test("10–11. configured CORS origin succeeds; unrelated rejected", async () => {
  const allow = ["https://almas-framework-v2-five.vercel.app"];
  assert.equal(
    resolveCorsOrigin(allow, "https://almas-framework-v2-five.vercel.app"),
    "https://almas-framework-v2-five.vercel.app"
  );
  assert.equal(resolveCorsOrigin(allow, "https://evil.example"), null);

  const app = minimalApp();
  const { base, close } = await listen(app);
  try {
    const ok = await fetch(`${base}/api/health`, {
      headers: { Origin: "https://almas-framework-v2-five.vercel.app" },
    });
    assert.equal(
      ok.headers.get("access-control-allow-origin"),
      "https://almas-framework-v2-five.vercel.app"
    );

    const bad = await fetch(`${base}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);

    // Regression: Mini App briefly sent Cache-Control request header.
    // Preflight must allow it (or the client must not send it).
    const preflight = await fetch(`${base}/api/dashboard`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://almas-framework-v2-five.vercel.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,cache-control",
      },
    });
    assert.equal(preflight.status, 204);
    const allowHeaders = String(
      preflight.headers.get("access-control-allow-headers") || ""
    ).toLowerCase();
    assert.match(allowHeaders, /authorization/);
    assert.match(allowHeaders, /cache-control/);
  } finally {
    await close();
  }
});

await test("12–13. valid initData derives actor; invalid rejected", async () => {
  const app = minimalApp();
  const { base, close } = await listen(app);
  try {
    const auth = `tma ${signInitDataForTests(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 42, first_name: "A" }),
      },
      BOT
    )}`;
    const ok = await fetch(`${base}/api/tasks`, {
      headers: { Authorization: auth },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data[0].title, "Купить молоко");

    const bad = await fetch(`${base}/api/tasks`, {
      headers: { Authorization: "tma invalid" },
    });
    assert.equal(bad.status, 401);
  } finally {
    await close();
  }
});

await test("14–15. finance reader uses same bare user id string", async () => {
  const seen = [];
  const financeReader = createFinanceReader({
    getBalanceFn: async (userId) => {
      seen.push(userId);
      return { VND: { income: 0, expense: 180000, balance: -180000 } };
    },
    getHistoryFn: async (userId) => {
      seen.push(userId);
      return [
        {
          id: "tx1",
          type: "expense",
          amount: 180000,
          currency: "VND",
          description: "кукла",
          created_at: new Date().toISOString(),
        },
      ];
    },
    getExpensesByPeriodFn: async () => ({}),
    getStatisticsFn: async () => ({ incomes: {}, expenses: {} }),
  });
  const inboxReader = createInboxReader({ listInboxItemsFn: async () => [] });
  const tasksReader = createTasksReader({});
  const knowledgeReader = createKnowledgeReader({});
  const app = createApp({
    botToken: BOT,
    financeReader,
    inboxReader,
    tasksReader,
    knowledgeReader,
    dashboardReader: createDashboardReader({
      financeReader,
      inboxReader,
      tasksReader,
      knowledgeReader,
    }),
    log: () => {},
  });
  const { base, close } = await listen(app);
  try {
    const auth = `tma ${signInitDataForTests(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 99, first_name: "B" }),
      },
      BOT
    )}`;
    const res = await fetch(`${base}/api/finance/transactions?period=month`, {
      headers: { Authorization: auth },
    });
    assert.equal(res.status, 200);
    assert.ok(seen.every((id) => id === "99"));
    const body = await res.json();
    assert.equal(body.data[0].amount, 180000);
  } finally {
    await close();
  }
});

await test("20. Capture reader is actor-scoped + durable load compatible", async () => {
  const remote = {
    id: "sess-1",
    actorKey: "telegram:7",
    chatId: 7,
    source: "text",
    originalText: "кофе",
    draft: {
      actions: [
        {
          type: "finance_expense",
          confidence: 0.9,
          payload: { amount: 1, currency: "VND", description: "кофе" },
        },
      ],
    },
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  const store = createCaptureSessionStore({
    loadByIdFn: async (id, actorKey) =>
      id === "sess-1" && actorKey === "telegram:7" ? remote : null,
  });
  const reader = createCaptureReader({ store });
  const miss = await reader.getById({ actorKey: "telegram:8" }, "sess-1");
  assert.equal(miss.item, null);
  const hit = await reader.getById({ actorKey: "telegram:7" }, "sess-1");
  assert.ok(hit.item);
  assert.equal(hit.item.sessionId, "sess-1");
});

await test("listTasksForActor is exported for API wiring", () => {
  assert.equal(typeof listTasksForActor, "function");
});

console.log(`\napi-hosting: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
