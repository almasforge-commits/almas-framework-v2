import assert from "node:assert/strict";
import {
  toInboxRow,
  fromInboxRow,
  insertInboxItem,
  updateInboxItemByRequestKey,
  findInboxItemByRequestKey,
  listInboxItems,
} from "../providers/storage/supabaseInboxDriver.js";
import { buildActorFromTelegram } from "../services/inbox/inboxContracts.js";

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

function fakeClient(handler) {
  const state = { calls: [] };

  function builder(table) {
    const ops = { table, filters: [], payload: null, op: null };
    const api = {
      upsert(row, opts) {
        ops.op = "upsert";
        ops.payload = row;
        ops.opts = opts;
        return api;
      },
      update(row) {
        ops.op = "update";
        ops.payload = row;
        return api;
      },
      select() {
        return api;
      },
      eq(col, val) {
        ops.filters.push(["eq", col, val]);
        return api;
      },
      contains(col, val) {
        ops.filters.push(["contains", col, val]);
        return api;
      },
      order() {
        return api;
      },
      range(from, to) {
        ops.range = [from, to];
        return api;
      },
      single: async () => handler(ops),
      maybeSingle: async () => handler(ops),
      then: undefined,
    };

    // For list: awaiting the builder itself
    api.then = (resolve, reject) =>
      Promise.resolve(handler(ops)).then(resolve, reject);

    state.calls.push(ops);
    return api;
  }

  return {
    state,
    supabase: {
      from(table) {
        return builder(table);
      },
    },
  };
}

const sampleItem = {
  requestKey: "msg:1:9",
  sourceType: "telegram_text",
  actor: buildActorFromTelegram({ id: 42, username: "almas", first_name: "A" }, 7),
  originalText: "hello",
  normalizedText: "hello",
  language: "ru",
  informationKinds: ["task"],
  status: "received",
  metadata: { embedding: Array.from({ length: 40 }, () => 1) },
};

async function run() {
  await test("toInboxRow / fromInboxRow mapping round-trip", () => {
    const row = toInboxRow(sampleItem);
    assert.equal(row.request_key, "msg:1:9");
    assert.equal(row.actor_key, "telegram:42");
    assert.equal(row.telegram_user_id, 42);
    assert.equal(row.chat_id, 7);
    assert.equal(row.first_name, "A");
    assert.deepEqual(row.information_kinds, ["task"]);
    assert.equal(row.metadata.embedding, "[redacted]");

    const item = fromInboxRow({
      ...row,
      id: "uuid-1",
      created_at: "t1",
      updated_at: "t2",
    });
    assert.equal(item.requestKey, "msg:1:9");
    assert.equal(item.actor.actorKey, "telegram:42");
    assert.equal(item.id, "uuid-1");
  });

  await test("insert mapping uses upsert on request_key", async () => {
    const { supabase, state } = fakeClient(async (ops) => ({
      data: { ...ops.payload, id: "1", created_at: "t", updated_at: "t" },
      error: null,
    }));
    const saved = await insertInboxItem(sampleItem, { supabase });
    assert.equal(state.calls[0].op, "upsert");
    assert.equal(state.calls[0].opts.onConflict, "request_key");
    assert.equal(saved.requestKey, "msg:1:9");
  });

  await test("update / find mapping", async () => {
    const { supabase } = fakeClient(async (ops) => ({
      data: {
        id: "1",
        request_key: "msg:1:9",
        source_type: "telegram_text",
        actor_key: "telegram:42",
        telegram_user_id: 42,
        chat_id: 7,
        username: "almas",
        first_name: "A",
        last_name: null,
        original_text: "hello",
        normalized_text: "hello",
        language: "ru",
        information_kinds: ["task"],
        routing_decision: ops.payload?.routing_decision ?? null,
        execution_summary: null,
        status: ops.payload?.status ?? "analyzed",
        error_code: null,
        metadata: {},
        created_at: "t",
        updated_at: "t",
      },
      error: null,
    }));

    const updated = await updateInboxItemByRequestKey(
      "msg:1:9",
      {
        status: "analyzed",
        language: "ru",
        informationKinds: ["task"],
        routingDecision: { mode: "shadow", reasonCode: "x", actions: [] },
      },
      { supabase }
    );
    assert.equal(updated.status, "analyzed");

    const found = await findInboxItemByRequestKey("msg:1:9", { supabase });
    assert.equal(found.requestKey, "msg:1:9");
  });

  await test("list mapping supports actor/source/status/kind/limit/offset", async () => {
    const { supabase, state } = fakeClient(async () => ({
      data: [],
      error: null,
    }));
    await listInboxItems(
      {
        actorKey: "telegram:42",
        sourceType: "telegram_text",
        status: "received",
        informationKind: "task",
        limit: 10,
        offset: 5,
      },
      { supabase }
    );
    const ops = state.calls[0];
    assert.ok(ops.filters.some((f) => f[0] === "eq" && f[1] === "actor_key"));
    assert.ok(ops.filters.some((f) => f[0] === "eq" && f[1] === "source_type"));
    assert.ok(ops.filters.some((f) => f[0] === "eq" && f[1] === "status"));
    assert.ok(ops.filters.some((f) => f[0] === "contains" && f[1] === "information_kinds"));
    assert.deepEqual(ops.range, [5, 14]);
  });

  await test("read/write errors throw; never silent empty on error", async () => {
    const { supabase } = fakeClient(async () => ({
      data: null,
      error: { message: "db down" },
    }));
    await assert.rejects(() => insertInboxItem(sampleItem, { supabase }), /INBOX_INSERT_FAILED/);
    await assert.rejects(() => findInboxItemByRequestKey("x", { supabase }), /INBOX_FIND_FAILED/);
    await assert.rejects(() => listInboxItems({}, { supabase }), /INBOX_LIST_FAILED/);
  });

  if (process.exitCode) console.error("\nSome supabase-inbox-driver tests failed.");
  else console.log("\nAll supabase-inbox-driver tests passed.");
}

run();
