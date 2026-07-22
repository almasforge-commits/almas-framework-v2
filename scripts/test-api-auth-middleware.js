import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../api/createApp.js";
import {
  AUTH_REASON,
  signInitDataForTests,
} from "../api/auth/validateInitData.js";
import { parseTmaAuthorizationHeader } from "../api/middleware/authTelegram.js";

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

async function request(base, path, headers = {}, method = "GET") {
  const res = await fetch(`${base}${path}`, { method, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
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
  await test("missing Authorization → missing_header", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox");
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, "unauthorized");
      assert.ok(logs.some((l) => l.includes("reason=missing_header")));
      assert.ok(logs.some((l) => l.includes("headerPresent=false")));
      assert.ok(!JSON.stringify(logs).includes("auth_date="));
    } finally {
      await close();
    }
  });

  await test("wrong scheme → invalid_scheme", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox", {
        Authorization: "Bearer x",
      });
      assert.equal(res.status, 401);
      assert.ok(logs.some((l) => l.includes("reason=invalid_scheme")));
      assert.ok(logs.some((l) => l.includes("scheme=other")));
    } finally {
      await close();
    }
  });

  await test("empty initData after tma → empty_init_data", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox", {
        Authorization: "tma    ",
      });
      assert.equal(res.status, 401);
      assert.ok(
        logs.some(
          (l) =>
            l.includes("reason=empty_init_data") ||
            l.includes("reason=invalid_scheme")
        )
      );
    } finally {
      await close();
    }
  });

  await test("invalid signature → signature_mismatch", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox", {
        Authorization: "tma auth_date=1&user=%7B%22id%22%3A1%7D&hash=00",
      });
      assert.equal(res.status, 401);
      assert.ok(logs.some((l) => l.includes("reason=signature_mismatch")));
      assert.ok(logs.some((l) => l.includes("hashPresent=true")));
    } finally {
      await close();
    }
  });

  await test("expired auth_date → expired_auth_date", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(String(c)),
      maxAgeSeconds: 60,
    });
    const { base, close } = await listen(app);
    try {
      const expired = signInitDataForTests(
        {
          auth_date: String(Math.floor(Date.now() / 1000) - 100000),
          user: JSON.stringify({ id: 1, first_name: "A" }),
        },
        BOT
      );
      const res = await request(base, "/api/inbox", {
        Authorization: `tma ${expired}`,
      });
      assert.equal(res.status, 401);
      assert.ok(logs.some((l) => l.includes("reason=expired_auth_date")));
      assert.ok(logs.some((l) => /ageSeconds=\d+/.test(l)));
    } finally {
      await close();
    }
  });

  await test("valid request derives actor; Authorization preserves raw initData", async () => {
    let seen = null;
    const readers = stubReaders();
    readers.inboxReader.list = async (actor) => {
      seen = actor;
      return { items: [], meta: { limit: 20, offset: 0, hasMore: false } };
    };
    const initData = signInitDataForTests(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 55, first_name: "Almas" }),
      },
      BOT
    );
    const header = `tma ${initData}`;
    const parsed = parseTmaAuthorizationHeader(header);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.initData, initData);

    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...readers,
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const res = await request(base, "/api/inbox", { Authorization: header });
      assert.equal(res.status, 200);
      assert.equal(seen.telegramUserId, 55);
      assert.equal(seen.actorKey, "telegram:55");
      assert.ok(logs.some((l) => l.includes("validation=ok")));
      assert.ok(!JSON.stringify(logs).includes(initData));
      assert.ok(!JSON.stringify(logs).includes(BOT));
    } finally {
      await close();
    }
  });

  await test("OPTIONS bypasses auth; GET requires auth", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      corsOrigin: "https://almas-framework-v2-five.vercel.app",
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const opt = await fetch(`${base}/api/finance/summary?period=month`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://almas-framework-v2-five.vercel.app",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      assert.equal(opt.status, 204);
      assert.ok(!logs.some((l) => l.includes("[auth]")));

      const denied = await request(base, "/api/finance/summary?period=month");
      assert.equal(denied.status, 401);

      const ok = await request(base, "/api/finance/summary?period=month", {
        Authorization: auth(1),
      });
      assert.equal(ok.status, 200);
    } finally {
      await close();
    }
  });

  await test("/health remains public", async () => {
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      supabaseReady: true,
      log: () => {},
    });
    const { base, close } = await listen(app);
    try {
      const a = await request(base, "/health");
      const b = await request(base, "/api/health");
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.deepEqual(a.body, { data: { ok: true, supabase: true } });
      assert.deepEqual(b.body, { data: { ok: true, supabase: true } });
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
    } finally {
      await close();
    }
  });

  await test("no raw initData/token/hash in logs or error bodies", async () => {
    const logs = [];
    const app = createApp({
      botToken: BOT,
      ...stubReaders(),
      log: (c) => logs.push(String(c)),
    });
    const { base, close } = await listen(app);
    try {
      const raw = auth(1);
      const initData = raw.slice(4);
      const hash = new URLSearchParams(initData).get("hash");
      const res = await request(base, "/api/inbox", {
        Authorization: raw + "tamper",
      });
      assert.equal(res.status, 401);
      const blob = `${JSON.stringify(res.body)}\n${logs.join("\n")}`;
      assert.ok(!blob.includes(BOT));
      assert.ok(!blob.includes("first_name"));
      assert.ok(!blob.includes(initData));
      if (hash) assert.ok(!blob.includes(hash));
      assert.ok(Object.values(AUTH_REASON).includes(AUTH_REASON.signature_mismatch));
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
