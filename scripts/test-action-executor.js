import assert from "node:assert/strict";

import {
  executeActions,
  EXECUTABLE_ACTION_TYPES,
  resetExecutionIdempotencyCacheForTests,
} from "../services/inbox/actionExecutor.js";
import { createAction } from "../services/inbox/contracts.js";

// The action-executor boundary. Always injects fake saveMemoryFn /
// classifyMemoryFn — never touches real Supabase/OpenAI.

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

function fakeDeps(overrides = {}) {
  return {
    saveMemoryFn: async () => true,
    classifyMemoryFn: () => ({ memoryType: "note", importance: 5, status: "active", tags: [] }),
    ...overrides,
  };
}

async function run() {
  await test("EXECUTABLE_ACTION_TYPES includes task_create, memory_save, idea_create", () => {
    assert.deepEqual(EXECUTABLE_ACTION_TYPES, [
      "task_create",
      "memory_save",
      "idea_create",
    ]);
  });

  await test("shadow mode (mode !== 'active') never executes anything, regardless of type", async () => {
    const actions = [
      createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } }),
      createAction({ type: "memory_save", confidence: 0.9, payload: { content: "note" } }),
    ];
    let called = false;
    const { results, executedCount } = await executeActions(
      actions,
      { mode: "shadow" },
      fakeDeps({ saveMemoryFn: async () => { called = true; return true; } })
    );
    assert.equal(called, false);
    assert.equal(executedCount, 0);
    assert.ok(results.every((r) => r.reason === "skipped_shadow_mode"));
  });

  await test("active mode executes task_create exactly once, with memoryType:'task' metadata", async () => {
    let receivedMetadata = null;
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } });
    const { results, executedCount } = await executeActions(
      [action],
      { mode: "active", chatId: 42, userId: 7, username: "almas", firstName: "Almas" },
      fakeDeps({
        saveMemoryFn: async (record) => {
          receivedMetadata = record.metadata;
          return true;
        },
      })
    );
    assert.equal(executedCount, 1);
    assert.equal(results[0].reason, "task_created");
    assert.equal(results[0].type, "task_create");
    assert.equal(receivedMetadata.memoryType, "task");
    assert.equal(receivedMetadata.actionType, "task_create");
    assert.equal(receivedMetadata.chatId, 42);
    assert.equal(receivedMetadata.userId, 7);
  });

  await test("active mode executes memory_save exactly once, using classifyMemoryFn's result", async () => {
    let receivedMetadata = null;
    const action = createAction({ type: "memory_save", confidence: 0.9, payload: { content: "мне нравится это кафе" } });
    const { executedCount, results } = await executeActions(
      [action],
      { mode: "active" },
      fakeDeps({
        classifyMemoryFn: (content) => {
          assert.equal(content, "мне нравится это кафе");
          return { memoryType: "note", importance: 5, status: "active", tags: ["cafe"] };
        },
        saveMemoryFn: async (record) => {
          receivedMetadata = record.metadata;
          return true;
        },
      })
    );
    assert.equal(executedCount, 1);
    assert.equal(results[0].reason, "memory_saved");
    assert.deepEqual(receivedMetadata.tags, ["cafe"]);
  });

  await test("finance actions are always skipped, never executed, even in active mode", async () => {
    const action = createAction({
      type: "finance_expense",
      confidence: 0.99,
      payload: { amount: 40000, currency: "VND" },
    });
    const { executedCount, results } = await executeActions([action], { mode: "active" }, fakeDeps());
    assert.equal(executedCount, 0);
    assert.equal(results[0].reason, "skipped_finance_not_enabled");
  });

  await test("destructive/system_command, knowledge_query, search, chat, unknown are all skipped in active mode", async () => {
    const types = ["system_command", "knowledge_query", "search", "chat", "unknown"];
    for (const type of types) {
      const action = createAction({ type, confidence: 0.9, payload: {} });
      const { executedCount, results } = await executeActions([action], { mode: "active" }, fakeDeps());
      assert.equal(executedCount, 0, `${type} must not execute`);
      assert.equal(results[0].reason, "skipped_not_enabled");
    }
  });

  await test("an action still requiring confirmation is never executed, even in active mode", async () => {
    const action = createAction({
      type: "task_create",
      confidence: 0.9,
      payload: { content: "x" },
      requiresConfirmation: true,
    });
    const { executedCount, results } = await executeActions([action], { mode: "active" }, fakeDeps());
    assert.equal(executedCount, 0);
    assert.equal(results[0].reason, "skipped_requires_confirmation");
  });

  await test("a duplicate action (same type+payload) within one call is executed only once", async () => {
    let calls = 0;
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } });
    const { executedCount, results } = await executeActions(
      [action, { ...action }, { ...action }],
      { mode: "active" },
      fakeDeps({ saveMemoryFn: async () => { calls += 1; return true; } })
    );
    assert.equal(calls, 1);
    assert.equal(executedCount, 1);
    assert.equal(results[1].reason, "skipped_duplicate");
    assert.equal(results[2].reason, "skipped_duplicate");
  });

  await test("preserves original action order in the results array", async () => {
    const actions = [
      createAction({ type: "finance_expense", confidence: 0.9, payload: { amount: 1 } }),
      createAction({ type: "task_create", confidence: 0.9, payload: { content: "a" } }),
      createAction({ type: "memory_save", confidence: 0.9, payload: { content: "b" } }),
    ];
    const { results } = await executeActions(actions, { mode: "active" }, fakeDeps());
    assert.deepEqual(results.map((r) => r.action.type), ["finance_expense", "task_create", "memory_save"]);
  });

  await test("a domain-service failure is recorded, never thrown, and does not stop later actions", async () => {
    const actions = [
      createAction({ type: "task_create", confidence: 0.9, payload: { content: "a" } }),
      createAction({ type: "memory_save", confidence: 0.9, payload: { content: "b" } }),
    ];
    let call = 0;
    const { results, executedCount } = await executeActions(
      actions,
      { mode: "active" },
      fakeDeps({
        saveMemoryFn: async () => {
          call += 1;
          if (call === 1) throw new Error("Supabase is down");
          return true;
        },
      })
    );
    assert.equal(results[0].reason, "domain_error");
    assert.equal(results[0].executed, false);
    assert.equal(results[1].executed, true);
    assert.equal(executedCount, 1);
  });

  await test("missing content on task_create/memory_save is recorded with a precise skipped_* reason, never invented", async () => {
    const actions = [
      createAction({ type: "task_create", confidence: 0.9, payload: {} }),
      createAction({ type: "memory_save", confidence: 0.9, payload: {} }),
    ];
    const { results } = await executeActions(actions, { mode: "active" }, fakeDeps());
    assert.equal(results[0].reason, "skipped_missing_task_content");
    assert.equal(results[0].type, "task_create");
    assert.equal(results[1].reason, "skipped_missing_memory_content");
    assert.equal(results[1].type, "memory_save");
  });

  await test("task_create execution result always identifies type=task_create when executed", async () => {
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } });
    const { results } = await executeActions([action], { mode: "active" }, fakeDeps());
    assert.equal(results[0].executed, true);
    assert.equal(results[0].type, "task_create");
    assert.equal(results[0].action.type, "task_create");
  });

  await test("repeated same requestKey does not execute the same action twice (cross-call idempotency)", async () => {
    resetExecutionIdempotencyCacheForTests();
    let calls = 0;
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } });
    const deps = fakeDeps({ saveMemoryFn: async () => { calls += 1; return true; } });

    const first = await executeActions([action], { mode: "active", requestKey: "msg:1:100" }, deps);
    assert.equal(first.executedCount, 1);
    assert.equal(first.results[0].reason, "task_created");

    const second = await executeActions([action], { mode: "active", requestKey: "msg:1:100" }, deps);
    assert.equal(second.executedCount, 0);
    assert.equal(second.results[0].reason, "skipped_duplicate_request");

    assert.equal(calls, 1, "saveMemoryFn must only be called once across both calls");
  });

  await test("different requestKeys with the identical action execute independently", async () => {
    resetExecutionIdempotencyCacheForTests();
    let calls = 0;
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } });
    const deps = fakeDeps({ saveMemoryFn: async () => { calls += 1; return true; } });

    const first = await executeActions([action], { mode: "active", requestKey: "msg:1:100" }, deps);
    const second = await executeActions([action], { mode: "active", requestKey: "msg:1:101" }, deps);

    assert.equal(first.executedCount, 1);
    assert.equal(second.executedCount, 1);
    assert.equal(calls, 2);
  });

  await test("a missing requestKey (null) never triggers cross-call dedup (only within-call dedup applies)", async () => {
    resetExecutionIdempotencyCacheForTests();
    let calls = 0;
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } });
    const deps = fakeDeps({ saveMemoryFn: async () => { calls += 1; return true; } });

    const first = await executeActions([action], { mode: "active", requestKey: null }, deps);
    const second = await executeActions([action], { mode: "active", requestKey: null }, deps);

    assert.equal(first.executedCount, 1);
    assert.equal(second.executedCount, 1);
    assert.equal(calls, 2);
  });

  await test("resetExecutionIdempotencyCacheForTests() actually clears state (test isolation helper works)", async () => {
    resetExecutionIdempotencyCacheForTests();
    const action = createAction({ type: "task_create", confidence: 0.9, payload: { content: "x" } });
    const deps = fakeDeps();

    await executeActions([action], { mode: "active", requestKey: "msg:9:1" }, deps);
    resetExecutionIdempotencyCacheForTests();
    const afterReset = await executeActions([action], { mode: "active", requestKey: "msg:9:1" }, deps);

    assert.equal(afterReset.executedCount, 1, "after a reset, the same requestKey must be able to execute again");
  });

  await test("empty/undefined actions array never throws", async () => {
    const { results, executedCount, skippedCount } = await executeActions(undefined, { mode: "active" }, fakeDeps());
    assert.deepEqual(results, []);
    assert.equal(executedCount, 0);
    assert.equal(skippedCount, 0);
  });

  if (process.exitCode) {
    console.error("\nSome action-executor tests failed.");
  } else {
    console.log("\nAll action-executor tests passed.");
  }
}

run();
