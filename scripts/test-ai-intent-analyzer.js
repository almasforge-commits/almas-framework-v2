import assert from "node:assert/strict";

import { analyzeIntent } from "../services/inbox/aiIntentAnalyzer.js";

// Tier 1 (cheap analyzer) — always injects a fake provider, never calls
// a real model.

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

async function run() {
  await test("returns ok:false when no provider is given (never crashes, never calls AI)", async () => {
    const result = await analyzeIntent({ normalized: "hi", original: "hi" }, {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_provider");
  });

  await test("passes the configured cheap model to the provider", async () => {
    let calledWithModel = null;
    const provider = {
      name: "fake",
      run: async (_input, { model }) => {
        calledWithModel = model;
        return {
          ok: true,
          result: { language: "en", actions: [], needsClarification: false, clarificationQuestion: null, shouldEscalate: false, reasonCode: "x" },
          usage: { model, latencyMs: 1 },
        };
      },
    };
    await analyzeIntent({ normalized: "hi" }, { provider, model: "gpt-5-nano" });
    assert.equal(calledWithModel, "gpt-5-nano");
  });

  await test("returns ok:true with the contract on a well-formed provider response", async () => {
    const contract = { language: "ru", actions: [], needsClarification: true, clarificationQuestion: "?", shouldEscalate: false, reasonCode: "x" };
    const provider = { run: async () => ({ ok: true, result: contract, usage: null }) };
    const result = await analyzeIntent({ normalized: "x" }, { provider });
    assert.equal(result.ok, true);
    assert.deepEqual(result.contract, contract);
    assert.equal(result.tier, "cheap");
  });

  await test("returns ok:false when the provider fails — never throws", async () => {
    const provider = { run: async () => ({ ok: false, result: null, reason: "provider_error" }) };
    const result = await analyzeIntent({ normalized: "x" }, { provider });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "provider_error");
  });

  await test("returns ok:false when the provider throws — never propagates", async () => {
    const provider = { run: async () => { throw new Error("boom"); } };
    const result = await analyzeIntent({ normalized: "x" }, { provider });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "provider_threw");
  });

  await test("returns ok:false when the response is missing a valid actions array", async () => {
    const provider = { run: async () => ({ ok: true, result: { language: "ru" } }) };
    const result = await analyzeIntent({ normalized: "x" }, { provider });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_response");
  });

  if (process.exitCode) {
    console.error("\nSome ai-intent-analyzer tests failed.");
  } else {
    console.log("\nAll ai-intent-analyzer tests passed.");
  }
}

run();
