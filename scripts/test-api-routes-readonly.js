import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../api/createApp.js";
import { signInitDataForTests } from "../api/auth/validateInitData.js";

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

function auth() {
  return `tma ${signInitDataForTests(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42, first_name: "Almas" }),
    },
    BOT
  )}`;
}

function stubReaders() {
  return {
    dashboardReader: {
      getHome: async (actor) => ({
        summary: {
          greetingName: actor.firstName,
          inboxToday: 0,
          expensesToday: 0,
          expensesTodayCurrency: "VND",
          activeTasks: 0,
          newKnowledge: 0,
          statusLabel: "Live",
        },
        todayActivity: [],
        recentTasks: [],
        recentKnowledge: [],
        recentActions: [],
      }),
    },
    inboxReader: {
      list: async () => ({
        items: [{ id: "i1", originalText: "x" }],
        meta: { limit: 20, offset: 0, hasMore: false },
      }),
    },
    financeReader: {
      getSummary: async (_a, period) => ({
        balance: 1,
        incomeMonth: 1,
        expensesMonth: 1,
        currency: "VND",
        period,
        demo: false,
      }),
      getTransactions: async (_a, { limit, offset }) => ({
        items: [],
        meta: { limit, offset, hasMore: false },
      }),
    },
    tasksReader: {
      list: async (_a, { limit, offset }) => ({
        items: [],
        meta: { limit, offset, hasMore: false },
        reason: "ownership_not_available",
      }),
    },
    knowledgeReader: {
      list: async (_a, { limit, offset }) => ({
        items: [],
        meta: { limit, offset, hasMore: false },
        reason: "ownership_not_available",
      }),
    },
  };
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

async function request(base, path, { method = "GET", headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function run() {
  await test("/api/health does not require auth", async () => {
    const app = createApp({ botToken: BOT, ...stubReaders(), log: () => {} });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/health");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { data: { ok: true } });
    } finally {
      await close();
    }
  });

  await test("all protected endpoints require auth", async () => {
    const app = createApp({ botToken: BOT, ...stubReaders(), log: () => {} });
    const { base, close } = await listen(app);
    try {
      for (const path of [
        "/api/dashboard",
        "/api/inbox",
        "/api/finance/summary",
        "/api/finance/transactions",
        "/api/tasks",
        "/api/knowledge",
      ]) {
        const res = await request(base, path);
        assert.equal(res.status, 401, path);
        assert.equal(res.body.error.code, "unauthorized");
      }
    } finally {
      await close();
    }
  });

  await test("authenticated GETs use data envelope + meta", async () => {
    const app = createApp({ botToken: BOT, ...stubReaders(), log: () => {} });
    const { base, close } = await listen(app);
    const headers = { Authorization: auth() };
    try {
      const dash = await request(base, "/api/dashboard", { headers });
      assert.equal(dash.status, 200);
      assert.ok(dash.body.data);
      assert.equal(dash.body.data.summary.greetingName, "Almas");

      const inbox = await request(base, "/api/inbox", { headers });
      assert.equal(inbox.status, 200);
      assert.ok(Array.isArray(inbox.body.data));
      assert.deepEqual(inbox.body.meta, {
        limit: 20,
        offset: 0,
        hasMore: false,
      });

      const fin = await request(base, "/api/finance/summary?period=week", {
        headers,
      });
      assert.equal(fin.status, 200);
      assert.equal(fin.body.data.period, "week");
      assert.equal(fin.body.data.demo, false);
    } finally {
      await close();
    }
  });

  await test("invalid period/limit/offset returns 400; limits capped", async () => {
    const seen = [];
    const readers = stubReaders();
    readers.inboxReader.list = async (_a, opts) => {
      seen.push(opts);
      return {
        items: [],
        meta: { limit: opts.limit, offset: opts.offset, hasMore: false },
      };
    };
    const app = createApp({ botToken: BOT, ...readers, log: () => {} });
    const { base, close } = await listen(app);
    const headers = { Authorization: auth() };
    try {
      const badPeriod = await request(
        base,
        "/api/finance/summary?period=year",
        { headers }
      );
      assert.equal(badPeriod.status, 400);
      assert.equal(badPeriod.body.error.code, "invalid_period");

      const badLimit = await request(base, "/api/inbox?limit=0", { headers });
      assert.equal(badLimit.status, 400);

      const badOffset = await request(base, "/api/inbox?offset=-1", { headers });
      assert.equal(badOffset.status, 400);

      const capped = await request(base, "/api/inbox?limit=500", { headers });
      assert.equal(capped.status, 200);
      assert.equal(seen.at(-1).limit, 100);
    } finally {
      await close();
    }
  });

  await test("POST/PATCH/DELETE are unavailable", async () => {
    const app = createApp({ botToken: BOT, ...stubReaders(), log: () => {} });
    const { base, close } = await listen(app);
    const headers = { Authorization: auth() };
    try {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await request(base, "/api/tasks", { method, headers });
        assert.ok(
          res.status === 404 || res.status === 405,
          `${method} => ${res.status}`
        );
      }
    } finally {
      await close();
    }
  });

  if (process.exitCode) {
    console.error("\nroutes readonly tests failed.");
    process.exit(1);
  }
  console.log("\nAll routes readonly tests passed.");
}

run();
