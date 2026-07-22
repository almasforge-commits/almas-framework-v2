/**
 * Supabase client creation / env validation — production Railway failure coverage.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../api/createApp.js";
import { signInitDataForTests } from "../api/auth/validateInitData.js";
import { createFinanceReader } from "../api/readers/financeReader.js";
import { createInboxReader } from "../api/readers/inboxReader.js";
import {
  createSupabaseClientFromEnv,
  createUnavailableSupabaseClient,
  detectSupabaseKeyFormat,
  getSupabaseClient,
  normalizeSupabaseEnvValue,
  readSupabaseConfig,
  requireSupabaseClient,
  resetSupabaseClientForTests,
  SUPABASE_REASON,
  supabaseKeyFingerprint,
  validateSupabaseUrl,
} from "../providers/storage/supabase.js";
import {
  FINANCE_ERROR,
  getFinanceSupabaseClient,
} from "../services/finance/financeStore.js";

const BOT = "supabase-config-test-bot";
const VALID_URL = "https://ohnepqwrrkjfvnyememw.supabase.co";
const VALID_PUBLISHABLE = "sb_publishable_almas_test_key_123456";
const VALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMH0.signaturepad";

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

const secretLeakRe =
  /ohnepqwrrkjfvnyememw|sb_publishable_almas_test_key|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/;

await test("1. valid URL + valid anon key creates a client", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: VALID_URL,
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  assert.ok(client);
  assert.equal(status.clientCreated, true);
  assert.equal(status.reasonCode, SUPABASE_REASON.ok);
  assert.equal(status.urlValid, true);
  assert.equal(status.keyFormat, "publishable");
  assert.equal(typeof client.from, "function");
});

await test("2. leading/trailing whitespace is normalized", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: `  ${VALID_URL}  `,
    SUPABASE_ANON_KEY: `  ${VALID_PUBLISHABLE}  `,
  });
  assert.ok(client);
  assert.equal(status.clientCreated, true);
});

await test("3. quoted values are normalized", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: `"${VALID_URL}"`,
    SUPABASE_ANON_KEY: `'${VALID_PUBLISHABLE}'`,
  });
  assert.ok(client);
  assert.equal(status.clientCreated, true);
  const norm = normalizeSupabaseEnvValue(`"${VALID_URL}"`);
  assert.equal(norm.malformed, false);
  assert.equal(norm.value, VALID_URL);
});

await test("4. ${{SUPABASE_URL}} is rejected", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: "${{SUPABASE_URL}}",
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  assert.equal(client, null);
  assert.equal(status.reasonCode, SUPABASE_REASON.malformed_env_value);
});

await test("5. ${{SUPABASE_ANON_KEY}} is rejected", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: VALID_URL,
    SUPABASE_ANON_KEY: "${{SUPABASE_ANON_KEY}}",
  });
  assert.equal(client, null);
  assert.equal(status.reasonCode, SUPABASE_REASON.malformed_env_value);
});

await test("6. SUPABASE_URL=... pasted as value is rejected", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: `SUPABASE_URL=${VALID_URL}`,
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  assert.equal(client, null);
  assert.equal(status.reasonCode, SUPABASE_REASON.malformed_env_value);
});

await test("7. invalid URL returns invalid_url", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: "https:ohnepqwrrkjfvnyememw.supabase.co",
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  assert.equal(client, null);
  assert.equal(status.reasonCode, SUPABASE_REASON.invalid_url);
  assert.equal(validateSupabaseUrl("not-a-url").valid, false);
});

await test("8. missing URL returns missing_url", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  assert.equal(client, null);
  assert.equal(status.reasonCode, SUPABASE_REASON.missing_url);
  const cfg = readSupabaseConfig({
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  assert.equal(cfg.ok, false);
  assert.equal(cfg.code, SUPABASE_REASON.missing_url);
});

await test("9. missing key returns missing_key", () => {
  const { client, status } = createSupabaseClientFromEnv({
    SUPABASE_URL: VALID_URL,
    SUPABASE_ANON_KEY: "",
  });
  assert.equal(client, null);
  assert.equal(status.reasonCode, SUPABASE_REASON.missing_key);
});

await test("10. ESM helper reads env at call time (no empty capture)", () => {
  const env = {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
  };
  const first = createSupabaseClientFromEnv(env);
  assert.equal(first.status.reasonCode, SUPABASE_REASON.missing_url);
  env.SUPABASE_URL = VALID_URL;
  env.SUPABASE_ANON_KEY = VALID_JWT;
  const second = createSupabaseClientFromEnv(env);
  assert.equal(second.status.clientCreated, true);
  assert.equal(detectSupabaseKeyFormat(VALID_JWT), "jwt");
});

await test("11. Finance and Inbox receive the same client", () => {
  resetSupabaseClientForTests({
    SUPABASE_URL: VALID_URL,
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  const a = getSupabaseClient();
  const b = getFinanceSupabaseClient();
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(a, requireSupabaseClient());
});

await test("12. unavailable client returns controlled 503", async () => {
  const reader = createFinanceReader({
    listRowsFn: async () => {
      const err = new Error("Supabase unavailable: invalid_url");
      err.code = FINANCE_ERROR.invalid_url;
      throw err;
    },
  });
  await assert.rejects(
    () => reader.getSummary({ userId: "1", telegramUserId: 1 }, "month"),
    (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.logCode, FINANCE_ERROR.invalid_url);
      return true;
    }
  );

  const facade = createUnavailableSupabaseClient({
    reasonCode: SUPABASE_REASON.missing_key,
  });
  assert.equal(facade.__almasUnavailable, true);
  assert.throws(() => facade.from("x"), /missing_key/);
});

await test("13. valid client allows Finance reader query", async () => {
  const rows = [
    {
      id: "1",
      type: "expense",
      amount: 1000,
      currency: "VND",
      category: "Test",
      description: "x",
      user_id: "42",
      created_at: new Date().toISOString(),
    },
  ];
  const reader = createFinanceReader({
    listRowsFn: async (userId) => {
      assert.equal(userId, "42");
      return rows;
    },
  });
  const summary = await reader.getSummary(
    { userId: "42", telegramUserId: 42 },
    "month"
  );
  assert.equal(summary.expensesMonth, 1000);
  assert.equal(summary.currency, "VND");
});

await test("14. valid client allows Inbox reader query", async () => {
  const reader = createInboxReader({
    listInboxItemsFn: async () => [
      {
        id: "i1",
        requestKey: "r1",
        sourceType: "text",
        actor: { actorKey: "tg:9", telegramUserId: 9 },
        originalText: "hi",
        normalizedText: "hi",
        language: "en",
        informationKinds: [],
        status: "received",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      },
    ],
  });
  const result = await reader.list(
    { actorKey: "tg:9", telegramUserId: 9 },
    { limit: 10, offset: 0 }
  );
  assert.equal(result.items.length, 1);
});

await test("15. no secret values are logged", () => {
  const lines = [];
  const { status } = createSupabaseClientFromEnv({
    SUPABASE_URL: VALID_URL,
    SUPABASE_ANON_KEY: VALID_PUBLISHABLE,
  });
  lines.push(JSON.stringify(status));
  lines.push(supabaseKeyFingerprint(VALID_PUBLISHABLE));
  const blob = lines.join("\n");
  // Host may appear (urlHost) — full URL and raw key must never appear.
  assert.ok(!blob.includes(VALID_URL));
  assert.ok(!blob.includes(VALID_PUBLISHABLE));
  assert.ok(!blob.includes(VALID_JWT));
  assert.ok(!/SUPABASE_ANON_KEY=/.test(blob));
  assert.equal(status.urlHost, "ohnepqwrrkjfvnyememw.supabase.co");
  assert.ok(status.keyFingerprint);
  assert.notEqual(status.keyFingerprint, VALID_PUBLISHABLE);
});

await test("12b. health reports supabase flag; unavailable → 503 finance", async () => {
  const financeReader = createFinanceReader({
    listRowsFn: async () => {
      const err = new Error("Supabase unavailable: create_client_exception");
      err.code = FINANCE_ERROR.create_client_exception;
      throw err;
    },
  });
  const inboxReader = createInboxReader({
    listInboxItemsFn: async () => {
      throw new Error("INBOX_LIST_FAILED");
    },
  });
  const app = createApp({
    botToken: BOT,
    financeReader,
    inboxReader,
    supabaseReady: false,
    log: () => {},
  });
  const { base, close } = await listen(app);
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.data.ok, true);
    assert.equal(health.data.supabase, false);

    const fin = await fetch(`${base}/api/finance/summary?period=month`, {
      headers: { Authorization: authFor(1) },
    });
    assert.equal(fin.status, 503);
    const body = await fin.json();
    assert.equal(body.error?.code, "service_unavailable");

    const inbox = await fetch(`${base}/api/inbox?limit=5`, {
      headers: { Authorization: authFor(1) },
    });
    assert.equal(inbox.status, 503);
    const inboxBody = await inbox.json();
    assert.equal(inboxBody.error?.code, "service_unavailable");
  } finally {
    await close();
  }
});

await test("jwt + publishable formats accepted", () => {
  const jwt = createSupabaseClientFromEnv({
    SUPABASE_URL: VALID_URL,
    SUPABASE_ANON_KEY: VALID_JWT,
  });
  assert.equal(jwt.status.clientCreated, true);
  assert.equal(jwt.status.keyFormat, "jwt");
});

console.log(`\nsupabase-config tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
