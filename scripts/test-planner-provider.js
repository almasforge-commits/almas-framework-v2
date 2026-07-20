import assert from "node:assert/strict";

import { createUnavailablePlannerProvider } from "../providers/ai/plannerProvider.js";
import { createOpenAiPlannerProvider } from "../providers/ai/openaiPlannerProvider.js";

// Provider layer tests. Never call the real OpenAI SDK — always inject
// askAIFn. Also verifies importing these modules never throws even
// without OPENAI_API_KEY set (lazy client construction).

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
  await test("createUnavailablePlannerProvider().run() always fails without throwing", async () => {
    const provider = createUnavailablePlannerProvider("no_api_key");
    const result = await provider.run({ systemPrompt: "s", userPrompt: "u" }, { model: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.result, null);
    assert.equal(result.reason, "no_api_key");
  });

  await test("createOpenAiPlannerProvider() never throws at construction time (no API key needed)", () => {
    const provider = createOpenAiPlannerProvider({ askAIFn: async () => null });
    assert.equal(provider.name, "openai");
    assert.equal(typeof provider.run, "function");
  });

  await test("run() returns ok:true with the parsed contract on success", async () => {
    const fakeContract = {
      language: "en",
      actions: [],
      needsClarification: false,
      clarificationQuestion: null,
      shouldEscalate: false,
      reasonCode: "ok",
    };
    const provider = createOpenAiPlannerProvider({
      askAIFn: async (systemPrompt, userPrompt, schema, options) => {
        assert.equal(options.model, "gpt-5-nano");
        return fakeContract;
      },
    });
    const result = await provider.run({ systemPrompt: "s", userPrompt: "u" }, { model: "gpt-5-nano" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, fakeContract);
    assert.equal(result.usage.model, "gpt-5-nano");
    assert.equal(typeof result.usage.latencyMs, "number");
  });

  await test("run() returns ok:false, reason:empty_response when askAI returns null (e.g. JSON parse failure)", async () => {
    const provider = createOpenAiPlannerProvider({ askAIFn: async () => null });
    const result = await provider.run({ systemPrompt: "s", userPrompt: "u" }, { model: "gpt-5-nano" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty_response");
  });

  await test("run() returns ok:false, reason:provider_error when askAI throws — never crashes the caller", async () => {
    const provider = createOpenAiPlannerProvider({
      askAIFn: async () => {
        throw new Error("network down");
      },
    });
    const result = await provider.run({ systemPrompt: "s", userPrompt: "u" }, { model: "gpt-5-nano" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "provider_error");
  });

  if (process.exitCode) {
    console.error("\nSome planner-provider tests failed.");
  } else {
    console.log("\nAll planner-provider tests passed.");
  }
}

run();
