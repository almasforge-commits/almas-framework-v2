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

function stubReaders() {
  return {
    dashboardReader: { getHome: async () => ({ summary: {} }) },
    inboxReader: {
      list: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
      }),
    },
    financeReader: {
      getSummary: async () => ({ demo: false }),
      getTransactions: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
      }),
    },
    tasksReader: {
      list: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
        reason: "ownership_not_available",
      }),
    },
    knowledgeReader: {
      list: async () => ({
        items: [],
        meta: { limit: 20, offset: 0, hasMore: false },
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

async function request(base, path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

function auth(userId = 42) {
  return `tma ${signInitDataForTests(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: userId, first_name: "Almas" }),
    },
    BOT
  )}`;
}

async function run() {
  await test("generic 401 for missing header", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(c),
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, {
        error: { code: "unauthorized", message: "Unauthorized" },
      });
      assert.ok(logs.some((l) => l.startsWith("auth_rejected:")));
      assert.ok(!JSON.stringify(logs).includes("auth_date="));
    } finally {
      await close();
    }
  });

  await test("generic 401 for bad scheme / invalid signature / expired", async () => {
    const app = createApp({ botToken: BOT, ...stubReaders(), log: () => {} });
    const { base, close } = await listen(app);
    try {
      const badScheme = await request(base, "/api/inbox", {
        Authorization: "Bearer x",
      });
      assert.equal(badScheme.status, 401);
      assert.equal(badScheme.body.error.code, "unauthorized");
      assert.equal(badScheme.body.error.message, "Unauthorized");

      const badSig = await request(base, "/api/inbox", {
        Authorization: "tma auth_date=1&user=%7B%22id%22%3A1%7D&hash=00",
      });
      assert.equal(badSig.status, 401);
      assert.equal(badSig.body.error.code, "unauthorized");

      const expired = signInitDataForTests(
        {
          auth_date: String(Math.floor(Date.now() / 1000) - 100000),
          user: JSON.stringify({ id: 1, first_name: "A" }),
        },
        BOT
      );
      const expRes = await request(base, "/api/inbox", {
        Authorization: `tma ${expired}`,
      });
      assert.equal(expRes.status, 401);
      assert.equal(expRes.body.error.code, "unauthorized");
    } finally {
      await close();
    }
  });

  await test("forged user-id headers are ignored", async () => {
    let seen = null;
    const readers = stubReaders();
    readers.inboxReader.list = async (actor) => {
      seen = actor;
      return { items: [], meta: { limit: 20, offset: 0, hasMore: false } };
    };
    const app = createApp({ botToken: BOT, ...readers, log: () => {} });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox", {
        Authorization: auth(55),
        "X-Telegram-User-Id": "99999",
        "X-User-Id": "88888",
      });
      assert.equal(res.status, 200);
      assert.equal(seen.telegramUserId, 55);
      assert.notEqual(seen.telegramUserId, 99999);
    } finally {
      await close();
    }
  });

  await test("no raw initData in error bodies", async () => {
    const app = createApp({ botToken: BOT, ...stubReaders(), log: () => {} });
    const { base, close } = await listen(app);
    try {
      const raw = auth(1);
      const res = await request(base, "/api/inbox", {
        Authorization: raw + "tamper",
      });
      assert.equal(res.status, 401);
      const s = JSON.stringify(res.body);
      assert.ok(!s.includes("auth_date"));
      assert.ok(!s.includes(BOT));
      assert.ok(!s.includes("first_name"));
    } finally {
      await close();
    }
  });

  if (process.exitCode) {
    console.error("\nauth middleware tests failed.");
    process.exit(1);
  }
  console.log("\nAll auth middleware tests passed.");
}

run();
