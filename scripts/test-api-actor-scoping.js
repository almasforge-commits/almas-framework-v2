import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../api/createApp.js";
import { signInitDataForTests } from "../api/auth/validateInitData.js";
import { createFinanceReader } from "../api/readers/financeReader.js";
import { createInboxReader } from "../api/readers/inboxReader.js";
import { createTasksReader } from "../api/readers/tasksReader.js";
import { createKnowledgeReader } from "../api/readers/knowledgeReader.js";
import { createDashboardReader } from "../api/readers/dashboardReader.js";

const BOT = "test-bot-token";

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
      user: JSON.stringify({ id: userId, first_name: "User" }),
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

async function run() {
  await test("finance actor scoping uses validated userId only", async () => {
    const seen = [];
    const financeReader = createFinanceReader({
      getBalanceFn: async (userId) => {
        seen.push(["balance", userId]);
        return { VND: { income: 0, expense: 0, balance: 0 } };
      },
      getHistoryFn: async (userId) => {
        seen.push(["history", userId]);
        return [];
      },
      getExpensesByPeriodFn: async (userId) => {
        seen.push(["expenses", userId]);
        return {};
      },
      getStatisticsFn: async (userId) => {
        seen.push(["stats", userId]);
        return { incomes: {}, expenses: {} };
      },
    });
    const inboxReader = createInboxReader({
      listInboxItemsFn: async () => [],
    });
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
      const res = await request(base, "/api/finance/summary?period=month", {
        Authorization: authFor(12345),
      });
      assert.equal(res.status, 200);
      assert.ok(seen.every(([, id]) => id === "12345"));
      assert.equal(res.body.data.demo, false);
    } finally {
      await close();
    }
  });

  await test("Inbox actor_key scoping is authoritative", async () => {
    let filtersSeen = null;
    const financeReader = {
      getSummary: async () => ({
        balance: 0,
        incomeMonth: 0,
        expensesMonth: 0,
        currency: "VND",
        period: "month",
        demo: false,
      }),
      getTransactions: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
      }),
    };
    const inboxReader = createInboxReader({
      listInboxItemsFn: async (filters) => {
        filtersSeen = filters;
        return [];
      },
    });
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
      const res = await request(base, "/api/inbox", {
        Authorization: authFor(88),
      });
      assert.equal(res.status, 200);
      assert.equal(filtersSeen.actorKey, "telegram:88");
      assert.equal(filtersSeen.telegramUserId, 88);
      assert.deepEqual(res.body.data, []);
      assert.equal(res.body.meta.hasMore, false);
    } finally {
      await close();
    }
  });

  await test("Inbox read failures return 503 not fake empty", async () => {
    const financeReader = {
      getSummary: async () => ({
        balance: 0,
        incomeMonth: 0,
        expensesMonth: 0,
        currency: "VND",
        period: "month",
        demo: false,
      }),
      getTransactions: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
      }),
    };
    const inboxReader = createInboxReader({
      listInboxItemsFn: async () => {
        throw new Error("relation inbox_items does not exist");
      },
    });
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
      const res = await request(base, "/api/inbox", {
        Authorization: authFor(1),
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "service_unavailable");
    } finally {
      await close();
    }
  });

  await test("Tasks fail closed if ownership cannot be enforced", async () => {
    const result = await createTasksReader({}).list({
      userId: "1",
      telegramUserId: 1,
      actorKey: "telegram:1",
    });
    assert.deepEqual(result.items, []);
    assert.equal(result.reason, "ownership_not_available");
  });

  await test("Knowledge fail closed if ownership cannot be enforced", async () => {
    const result = await createKnowledgeReader({}).list({
      userId: "1",
      telegramUserId: 1,
      actorKey: "telegram:1",
    });
    assert.deepEqual(result.items, []);
    assert.equal(result.reason, "ownership_not_available");
  });

  await test("Dashboard uses only scoped reader outputs", async () => {
    let unscopedCalled = false;
    const financeReader = {
      getSummary: async (actor) => {
        assert.equal(actor.userId, "7");
        return {
          balance: 10,
          incomeMonth: 1,
          expensesMonth: 2,
          currency: "VND",
          period: "month",
          demo: false,
        };
      },
      getTransactions: async (actor) => {
        assert.equal(actor.userId, "7");
        return {
          items: [],
          meta: { limit: 3, offset: 0, hasMore: false },
        };
      },
    };
    const inboxReader = {
      list: async (actor) => {
        assert.equal(actor.actorKey, "telegram:7");
        return {
          items: [],
          meta: { limit: 20, offset: 0, hasMore: false },
        };
      },
    };
    const tasksReader = {
      list: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
        reason: "ownership_not_available",
      }),
    };
    const knowledgeReader = {
      list: async () => ({
        items: [],
        meta: { limit: 10, offset: 0, hasMore: false },
        reason: "ownership_not_available",
      }),
    };
    // Simulate a forbidden unscoped service that dashboard must never call.
    const getAllKnowledge = async () => {
      unscopedCalled = true;
      return [{ id: "leak" }];
    };
    void getAllKnowledge;

    const dash = createDashboardReader({
      financeReader,
      inboxReader,
      tasksReader,
      knowledgeReader,
    });
    const home = await dash.getHome({
      userId: "7",
      telegramUserId: 7,
      actorKey: "telegram:7",
      firstName: "A",
    });
    assert.equal(home.summary.expensesTodayCurrency, "VND");
    assert.equal(unscopedCalled, false);
    assert.deepEqual(home.recentKnowledge, []);
  });

  if (process.exitCode) {
    console.error("\nactor scoping tests failed.");
    process.exit(1);
  }
  console.log("\nAll actor scoping tests passed.");
}

run();
