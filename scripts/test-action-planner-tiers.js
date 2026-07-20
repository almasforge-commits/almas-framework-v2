import assert from "node:assert/strict";

import { shouldEscalateToMediumTier, planWithMediumTier } from "../services/inbox/actionPlanner.js";

// Tier 2 (medium planner) escalation logic — pure decision function plus
// an injected-provider call. Never touches a real model.

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

function cheap(contractOverrides = {}, ok = true) {
  return {
    ok,
    contract: ok
      ? {
          language: "ru",
          actions: [],
          needsClarification: false,
          clarificationQuestion: null,
          shouldEscalate: false,
          reasonCode: "x",
          ...contractOverrides,
        }
      : null,
  };
}

async function run() {
  await test("Tier 1 failure never escalates to Tier 2 (handled as deterministic fallback instead)", () => {
    const result = shouldEscalateToMediumTier(cheap({}, false), { normalized: "x" });
    assert.equal(result, false);
  });

  await test("cheap-model explicit shouldEscalate:true triggers escalation", () => {
    const result = shouldEscalateToMediumTier(cheap({ shouldEscalate: true }), { normalized: "x" });
    assert.equal(result, true);
  });

  await test("a confident, complete multi-action plan does NOT escalate just because it has multiple actions", () => {
    const actions = [
      { type: "finance_expense", confidence: 0.95, payload: { amount: 40000, currency: "VND", description: "кофе" } },
      { type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" } },
    ];
    const result = shouldEscalateToMediumTier(cheap({ actions }), { normalized: "x" }, { confidenceThreshold: 0.85 });
    assert.equal(result, false);
  });

  await test("a malformed action (invalid/unknown type) triggers escalation", () => {
    const actions = [{ type: "delete_everything", confidence: 0.9, payload: {} }];
    const result = shouldEscalateToMediumTier(cheap({ actions }), { normalized: "x" });
    assert.equal(result, true);
  });

  await test("an action missing its required entity (e.g. finance with no amount) triggers escalation, never guessed", () => {
    const actions = [{ type: "finance_expense", confidence: 0.97, payload: { currency: "VND" } }];
    const result = shouldEscalateToMediumTier(cheap({ actions }), { normalized: "x" });
    assert.equal(result, true);
  });

  await test("Tier 1's own explicit needsClarification signal triggers escalation", () => {
    const result = shouldEscalateToMediumTier(
      cheap({ needsClarification: true, actions: [] }),
      { normalized: "x" }
    );
    assert.equal(result, true);
  });

  await test("cheap-model low confidence (below threshold) triggers escalation exactly when expected", () => {
    const actions = [{ type: "finance_expense", confidence: 0.3, payload: { amount: 5000, currency: "VND" } }];
    const result = shouldEscalateToMediumTier(cheap({ actions }), { normalized: "x" }, { confidenceThreshold: 0.85 });
    assert.equal(result, true);
  });

  await test("cheap-model high confidence does NOT trigger escalation", () => {
    const actions = [{ type: "finance_expense", confidence: 0.97, payload: { amount: 20, currency: "USD" } }];
    const result = shouldEscalateToMediumTier(cheap({ actions }), { normalized: "x" }, { confidenceThreshold: 0.85 });
    assert.equal(result, false);
  });

  await test("very long input triggers escalation even with a single high-confidence, complete action", () => {
    const actions = [{ type: "chat", confidence: 0.99, payload: { query: "some question" } }];
    const longText = "слово ".repeat(60);
    const result = shouldEscalateToMediumTier(cheap({ actions }), { normalized: longText }, { confidenceThreshold: 0.85 });
    assert.equal(result, true);
  });

  await test("planWithMediumTier calls the provider with the medium model exactly once", async () => {
    let callCount = 0;
    let modelUsed = null;
    const provider = {
      run: async (_input, { model }) => {
        callCount += 1;
        modelUsed = model;
        return {
          ok: true,
          result: { language: "ru", actions: [], needsClarification: false, clarificationQuestion: null, shouldEscalate: false, reasonCode: "x" },
          usage: { model, latencyMs: 2 },
        };
      },
    };
    const result = await planWithMediumTier({ normalized: "x" }, { provider, model: "gpt-5-mini" });
    assert.equal(callCount, 1);
    assert.equal(modelUsed, "gpt-5-mini");
    assert.equal(result.ok, true);
    assert.equal(result.tier, "medium");
  });

  await test("planWithMediumTier degrades gracefully (no throw) on provider failure", async () => {
    const provider = { run: async () => ({ ok: false, result: null, reason: "provider_error" }) };
    const result = await planWithMediumTier({ normalized: "x" }, { provider });
    assert.equal(result.ok, false);
  });

  if (process.exitCode) {
    console.error("\nSome action-planner-tiers tests failed.");
  } else {
    console.log("\nAll action-planner-tiers tests passed.");
  }
}

run();
