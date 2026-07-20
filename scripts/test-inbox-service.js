import assert from "node:assert/strict";
import {
  createReceivedInboxItem,
  recordInboxAnalysis,
  recordInboxExecution,
  recordInboxFailure,
  getInboxItems,
  observeInboxLifecycle,
} from "../services/inbox/inboxService.js";
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

const actor = buildActorFromTelegram({ id: 99, username: "u" }, 1);

async function run() {
  await test("disabled causes zero driver calls", async () => {
    let calls = 0;
    const result = await createReceivedInboxItem(
      {
        requestKey: "msg:1:1",
        sourceType: "telegram_text",
        actor,
        originalText: "hi",
      },
      {
        insertInboxItemFn: async () => {
          calls += 1;
          return null;
        },
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "inbox_disabled");
    assert.equal(calls, 0);
  });

  await test("enabled shadow creates a received item", async () => {
    const result = await createReceivedInboxItem(
      {
        requestKey: "msg:1:2",
        sourceType: "telegram_text",
        actor,
        originalText: "Завтра купить батарейки",
        normalizedText: "Завтра купить батарейки",
      },
      {
        forceEnabled: true,
        insertInboxItemFn: async (item) => ({ ...item, id: "id-1", status: "received" }),
      }
    );
    assert.equal(result.success, true);
    assert.equal(result.item.status, "received");
    assert.equal(result.item.requestKey, "msg:1:2");
  });

  await test("duplicate requestKey uses upsert path (insert called once with same key)", async () => {
    const keys = [];
    await createReceivedInboxItem(
      { requestKey: "dup", sourceType: "telegram_text", actor, originalText: "a" },
      {
        forceEnabled: true,
        insertInboxItemFn: async (item) => {
          keys.push(item.requestKey);
          return { ...item, id: "1" };
        },
      }
    );
    await createReceivedInboxItem(
      { requestKey: "dup", sourceType: "telegram_text", actor, originalText: "b" },
      {
        forceEnabled: true,
        insertInboxItemFn: async (item) => {
          keys.push(item.requestKey);
          return { ...item, id: "1" };
        },
      }
    );
    assert.deepEqual(keys, ["dup", "dup"]);
  });

  await test("analysis records language/kinds/sanitized decision + clarification", async () => {
    let patch = null;
    const result = await recordInboxAnalysis(
      "msg:1:3",
      {
        normalizedText: "Потратил 40000 на кофе и завтра купить батарейки",
        language: "ru",
        routingDecision: {
          language: "ru",
          needsClarification: false,
          actions: [
            { type: "finance_expense", confidence: 0.9 },
            { type: "task_create", confidence: 0.9 },
          ],
          reasonCode: "multi",
        },
      },
      {
        forceEnabled: true,
        updateInboxItemByRequestKeyFn: async (key, p) => {
          patch = p;
          return { requestKey: key, ...p };
        },
      }
    );
    assert.equal(result.success, true);
    assert.deepEqual(patch.informationKinds, ["finance", "task"]);
    assert.equal(patch.status, "analyzed");
    assert.equal(patch.routingDecision.reasonCode, "multi");

    const clar = await recordInboxAnalysis(
      "msg:1:4",
      {
        normalizedText: "?",
        routingDecision: { needsClarification: true, actions: [] },
      },
      {
        forceEnabled: true,
        updateInboxItemByRequestKeyFn: async (key, p) => ({ requestKey: key, ...p }),
      }
    );
    assert.equal(clar.item.status, "clarification_required");
  });

  await test("execution / partial / failure statuses", async () => {
    const exec = await recordInboxExecution(
      "k1",
      {
        results: [{ action: { type: "task_create" }, executed: true, reason: "task_created" }],
        executedCount: 1,
        skippedCount: 0,
      },
      {
        forceEnabled: true,
        updateInboxItemByRequestKeyFn: async (key, p) => ({ requestKey: key, ...p }),
      }
    );
    assert.equal(exec.item.status, "executed");

    const partial = await recordInboxExecution(
      "k2",
      {
        results: [
          { action: { type: "task_create" }, executed: true, reason: "task_created" },
          { action: { type: "finance_expense" }, executed: false, reason: "skipped_finance_not_enabled" },
        ],
        executedCount: 1,
        skippedCount: 1,
      },
      {
        forceEnabled: true,
        updateInboxItemByRequestKeyFn: async (key, p) => ({ requestKey: key, ...p }),
      }
    );
    assert.equal(partial.item.status, "partially_executed");

    const fail = await recordInboxFailure("k3", "provider_failed", {
      forceEnabled: true,
      updateInboxItemByRequestKeyFn: async (key, p) => ({ requestKey: key, ...p }),
    });
    assert.equal(fail.item.status, "failed");
    assert.equal(fail.item.errorCode, "provider_failed");
  });

  await test("max text length is capped", async () => {
    let saved = null;
    const long = "я".repeat(20000);
    await createReceivedInboxItem(
      {
        requestKey: "long",
        sourceType: "telegram_text",
        actor,
        originalText: long,
        normalizedText: long,
      },
      {
        forceEnabled: true,
        insertInboxItemFn: async (item) => {
          saved = item;
          return item;
        },
      }
    );
    assert.ok(saved.originalText.length <= 12000);
    assert.ok(saved.normalizedText.length <= 12000);
  });

  await test("malformed actor / missing requestKey rejected safely", async () => {
    const a = await createReceivedInboxItem(
      { requestKey: "", sourceType: "telegram_text", actor, originalText: "x" },
      { forceEnabled: true, insertInboxItemFn: async () => ({}) }
    );
    assert.equal(a.success, false);
    assert.equal(a.errorCode, "invalid_request_key");

    const b = await createReceivedInboxItem(
      { requestKey: "k", sourceType: "telegram_text", actor: null, originalText: "x" },
      { forceEnabled: true, insertInboxItemFn: async () => ({}) }
    );
    assert.equal(b.success, false);
    assert.equal(b.errorCode, "invalid_actor");
  });

  await test("driver failure returns structured failure; observe never throws", async () => {
    const result = await createReceivedInboxItem(
      { requestKey: "k", sourceType: "telegram_text", actor, originalText: "x" },
      {
        forceEnabled: true,
        insertInboxItemFn: async () => {
          throw new Error("db down");
        },
      }
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "Error");

    const observed = await observeInboxLifecycle(
      { requestKey: "k", actor, originalText: "x", sourceType: "telegram_text" },
      "received",
      {
        forceEnabled: true,
        insertInboxItemFn: async () => {
          throw new Error("boom");
        },
      }
    );
    assert.equal(observed.success, false);
  });

  await test("getInboxItems disabled skips driver", async () => {
    let calls = 0;
    const result = await getInboxItems(
      { actorKey: "telegram:1" },
      {
        listInboxItemsFn: async () => {
          calls += 1;
          return [];
        },
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(calls, 0);
  });

  if (process.exitCode) console.error("\nSome inbox-service tests failed.");
  else console.log("\nAll inbox-service tests passed.");
}

run();
