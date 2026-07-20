import assert from "node:assert/strict";

import { validateRoutingContract } from "../services/inbox/actionValidator.js";
import { createAction, createRoutingContract } from "../services/inbox/contracts.js";

// The deterministic Safety Validator — pure, no I/O. Treats every input
// as untrusted (as if it came straight from an AI provider).

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
  test("unknown action type is rejected, not executed", () => {
    const raw = createRoutingContract({
      actions: [{ type: "delete_everything", confidence: 1, payload: {}, requiresConfirmation: false }],
    });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.actions.length, 0);
    assert.equal(result.rejectedActions[0].reason, "unknown_action_type");
    assert.equal(result.needsClarification, true);
  });

  test("destructive action gets requiresConfirmation forced to true, typed input keeps it as a valid-but-confirm-required action", () => {
    const raw = createRoutingContract({
      actions: [
        createAction({
          type: "system_command",
          confidence: 1,
          payload: { command: "delete_all_knowledge" },
          requiresConfirmation: false,
        }),
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].requiresConfirmation, true);
    assert.equal(result.wouldExecute, false, "an action needing confirmation must never be marked executable");
  });

  test("voice input can never carry a destructive action — rejected outright", () => {
    const raw = createRoutingContract({
      actions: [
        createAction({
          type: "system_command",
          payload: { command: "delete_last_transaction" },
        }),
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "voice" });
    assert.equal(result.actions.length, 0);
    assert.equal(result.rejectedActions[0].reason, "voice_destructive_blocked");
  });

  test("low-confidence financial amount requires clarification, never executes", () => {
    const raw = createRoutingContract({
      actions: [
        createAction({
          type: "finance_expense",
          confidence: 0.4,
          payload: { amount: 5000, currency: "VND", description: "кофе" },
        }),
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "text", confidenceThreshold: 0.85 });
    assert.equal(result.actions.length, 0);
    assert.equal(result.rejectedActions[0].reason, "low_confidence_amount");
    assert.equal(result.needsClarification, true);
  });

  test("missing amount on a finance action requires clarification, never invents a value", () => {
    const raw = createRoutingContract({
      actions: [createAction({ type: "finance_expense", confidence: 0.9, payload: { currency: "VND" } })],
    });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.actions.length, 0);
    assert.equal(result.rejectedActions[0].reason, "missing_amount");
  });

  test("high-confidence finance action with an amount is accepted", () => {
    const raw = createRoutingContract({
      actions: [
        createAction({
          type: "finance_expense",
          confidence: 0.95,
          payload: { amount: 20, currency: "USD", description: "lunch" },
        }),
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "text", confidenceThreshold: 0.85 });
    assert.equal(result.actions.length, 1);
    assert.equal(result.wouldExecute, true);
  });

  test("preserves original action order for multiple actions", () => {
    const raw = createRoutingContract({
      actions: [
        createAction({ type: "finance_expense", confidence: 0.95, payload: { amount: 40000, currency: "VND" } }),
        createAction({ type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" } }),
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.actions.length, 2);
    assert.equal(result.actions[0].type, "finance_expense");
    assert.equal(result.actions[1].type, "task_create");
  });

  test("caps actions at maxActions, rejecting the overflow", () => {
    const raw = createRoutingContract({
      actions: [
        createAction({ type: "chat", confidence: 0.9, payload: { query: "a" } }),
        createAction({ type: "chat", confidence: 0.9, payload: { query: "b" } }),
        createAction({ type: "chat", confidence: 0.9, payload: { query: "c" } }),
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "text", maxActions: 2 });
    assert.equal(result.actions.length, 2);
    assert.equal(result.rejectedActions.length, 1);
    assert.equal(result.rejectedActions[0].reason, "max_actions_exceeded");
  });

  test("deduplicates identical actions to prevent duplicate execution", () => {
    const duplicateAction = createAction({
      type: "task_create",
      confidence: 0.9,
      payload: { content: "купить батарейки" },
    });
    const raw = createRoutingContract({ actions: [duplicateAction, { ...duplicateAction }] });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.actions.length, 1);
    assert.equal(result.rejectedActions[0].reason, "duplicate_action");
  });

  test("no safe action -> needsClarification:true with a fallback question when the AI didn't provide one", () => {
    const raw = createRoutingContract({ actions: [] });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.needsClarification, true);
    assert.ok(result.clarificationQuestion);
  });

  test("garbage/unknown input never defaults to a Memory-eligible action", () => {
    const raw = createRoutingContract({
      language: "unknown",
      actions: [createAction({ type: "unknown", confidence: 1 })],
    });
    const result = validateRoutingContract(raw, { inputSource: "voice" });
    // "unknown" is a valid, closed action type but never memory_save —
    // the validator must not upgrade it into anything memory-eligible.
    assert.equal(result.actions.every((a) => a.type !== "memory_save"), true);
  });

  test("malformed contract (not an object) degrades safely instead of throwing", () => {
    assert.doesNotThrow(() => validateRoutingContract(null, {}));
    assert.doesNotThrow(() => validateRoutingContract(undefined, {}));
    assert.doesNotThrow(() => validateRoutingContract("not an object", {}));
    const result = validateRoutingContract(null, { inputSource: "text" });
    assert.equal(result.needsClarification, true);
  });

  test("payload is sanitized to the fixed PAYLOAD_FIELDS set, dropping unexpected keys", () => {
    const raw = createRoutingContract({
      actions: [
        {
          type: "chat",
          confidence: 1,
          payload: { query: "hi", maliciousField: "DROP TABLE" },
          requiresConfirmation: false,
        },
      ],
    });
    const result = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(result.actions[0].payload.maliciousField, undefined);
    assert.equal(result.actions[0].payload.query, "hi");
  });

  if (process.exitCode) {
    console.error("\nSome action-validator tests failed.");
  } else {
    console.log("\nAll action-validator tests passed.");
  }
}

run();
