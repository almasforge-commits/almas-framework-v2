import assert from "node:assert/strict";

import {
  ACTION_TYPES,
  LANGUAGES,
  PAYLOAD_FIELDS,
  DESTRUCTIVE_COMMAND_IDS,
  isValidActionType,
  isValidLanguage,
  isDestructiveAction,
  createAction,
  createRoutingContract,
} from "../services/inbox/contracts.js";

// Pure vocabulary module — no network, no filesystem, no Telegram.

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function run() {
  test("ACTION_TYPES is a fixed, closed set including 'unknown'", () => {
    assert.ok(Array.isArray(ACTION_TYPES));
    assert.ok(ACTION_TYPES.includes("unknown"));
    assert.ok(ACTION_TYPES.includes("finance_expense"));
    assert.ok(ACTION_TYPES.includes("finance_income"));
    assert.ok(ACTION_TYPES.includes("task_create"));
    assert.ok(ACTION_TYPES.includes("memory_save"));
    assert.ok(ACTION_TYPES.includes("knowledge_query"));
    assert.ok(ACTION_TYPES.includes("search"));
    assert.ok(ACTION_TYPES.includes("chat"));
    assert.ok(ACTION_TYPES.includes("system_command"));
  });

  test("isValidActionType rejects free-form action names", () => {
    assert.equal(isValidActionType("finance_expense"), true);
    assert.equal(isValidActionType("delete_everything"), false);
    assert.equal(isValidActionType(""), false);
    assert.equal(isValidActionType(undefined), false);
  });

  test("isValidLanguage covers ru/en/kk/mixed/unknown only", () => {
    assert.deepEqual(LANGUAGES, ["ru", "en", "kk", "mixed", "unknown"]);
    assert.equal(isValidLanguage("ru"), true);
    assert.equal(isValidLanguage("fr"), false);
  });

  test("isDestructiveAction only flags known destructive system_command ids", () => {
    assert.equal(
      isDestructiveAction(
        createAction({ type: "system_command", payload: { command: "delete_all_knowledge" } })
      ),
      true
    );
    assert.equal(
      isDestructiveAction(
        createAction({ type: "system_command", payload: { command: "balance" } })
      ),
      false
    );
    assert.equal(
      isDestructiveAction(createAction({ type: "finance_expense", payload: {} })),
      false
    );
    assert.equal(isDestructiveAction(null), false);
  });

  test("DESTRUCTIVE_COMMAND_IDS contains delete_all_knowledge and delete_last_transaction", () => {
    assert.ok(DESTRUCTIVE_COMMAND_IDS.includes("delete_all_knowledge"));
    assert.ok(DESTRUCTIVE_COMMAND_IDS.includes("delete_last_transaction"));
  });

  test("createAction never invents fields — missing confidence defaults to 0, not undefined", () => {
    const action = createAction({ type: "chat" });
    assert.equal(action.confidence, 0);
    assert.deepEqual(action.payload, {});
    assert.equal(action.requiresConfirmation, false);
  });

  test("createRoutingContract fills every required field with a safe default", () => {
    const contract = createRoutingContract();
    assert.equal(contract.language, "unknown");
    assert.deepEqual(contract.actions, []);
    assert.equal(contract.needsClarification, false);
    assert.equal(contract.clarificationQuestion, null);
    assert.equal(contract.shouldEscalate, false);
    assert.equal(contract.reasonCode, "unspecified");
  });

  test("PAYLOAD_FIELDS is a fixed, closed set", () => {
    assert.deepEqual(PAYLOAD_FIELDS, [
      "amount",
      "currency",
      "description",
      "content",
      "query",
      "date",
      "command",
    ]);
  });

  if (process.exitCode) {
    console.error("\nSome ai-router-contracts tests failed.");
  } else {
    console.log("\nAll ai-router-contracts tests passed.");
  }
}

run();
