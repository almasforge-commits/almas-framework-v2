import assert from "node:assert/strict";

// config/aiRouter.js reads process.env at import time, so each scenario
// needs a fresh module instance — re-imported with a cache-busting query
// string after changing env vars. No network/filesystem/Telegram access.

const CONFIG_PATH = new URL("../config/aiRouter.js", import.meta.url).href;

const ENV_KEYS = [
  "AI_ROUTER_ENABLED",
  "AI_ROUTER_MODE",
  "AI_ROUTER_CHEAP_MODEL",
  "AI_ROUTER_MEDIUM_MODEL",
  "AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD",
  "AI_ROUTER_MAX_INPUT_CHARS",
  "AI_ROUTER_MAX_ACTIONS",
];

const originalEnv = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

async function freshImport() {
  return import(`${CONFIG_PATH}?t=${Date.now()}-${Math.random()}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    resetEnv();
  }
}

async function run() {
  await test("defaults: enabled=true, mode=shadow, cheap=gpt-5-nano, medium=gpt-5-mini", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = await freshImport();
    assert.equal(config.AI_ROUTER_ENABLED, true);
    assert.equal(config.AI_ROUTER_MODE, "shadow");
    assert.equal(config.AI_ROUTER_CHEAP_MODEL, "gpt-5-nano");
    assert.equal(config.AI_ROUTER_MEDIUM_MODEL, "gpt-5-mini");
    assert.equal(config.AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD, 0.85);
    assert.equal(config.AI_ROUTER_MAX_INPUT_CHARS, 6000);
    assert.equal(config.AI_ROUTER_MAX_ACTIONS, 5);
    assert.equal(config.isAiRouterActive(), true);
  });

  await test("AI_ROUTER_MODE=off disables the router (isAiRouterActive() -> false)", async () => {
    process.env.AI_ROUTER_MODE = "off";
    const config = await freshImport();
    assert.equal(config.AI_ROUTER_MODE, "off");
    assert.equal(config.isAiRouterActive(), false);
  });

  await test("AI_ROUTER_ENABLED=false disables the router even if mode is active", async () => {
    process.env.AI_ROUTER_ENABLED = "false";
    process.env.AI_ROUTER_MODE = "active";
    const config = await freshImport();
    assert.equal(config.isAiRouterActive(), false);
  });

  await test("invalid AI_ROUTER_MODE value falls back to the safe default 'shadow'", async () => {
    process.env.AI_ROUTER_MODE = "turbo";
    const config = await freshImport();
    assert.equal(config.AI_ROUTER_MODE, "shadow");
  });

  await test("model names and thresholds are overridable via env vars", async () => {
    process.env.AI_ROUTER_CHEAP_MODEL = "gpt-5-nano-custom";
    process.env.AI_ROUTER_MEDIUM_MODEL = "gpt-5-mini-custom";
    process.env.AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD = "0.6";
    process.env.AI_ROUTER_MAX_INPUT_CHARS = "1234";
    process.env.AI_ROUTER_MAX_ACTIONS = "3";
    const config = await freshImport();
    assert.equal(config.AI_ROUTER_CHEAP_MODEL, "gpt-5-nano-custom");
    assert.equal(config.AI_ROUTER_MEDIUM_MODEL, "gpt-5-mini-custom");
    assert.equal(config.AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD, 0.6);
    assert.equal(config.AI_ROUTER_MAX_INPUT_CHARS, 1234);
    assert.equal(config.AI_ROUTER_MAX_ACTIONS, 3);
  });

  await test("getAiRouterConfig() returns a plain sanitized snapshot (no secrets)", async () => {
    delete process.env.AI_ROUTER_MODE;
    const config = await freshImport();
    const snapshot = config.getAiRouterConfig();
    assert.deepEqual(Object.keys(snapshot).sort(), [
      "cheapConfidenceThreshold",
      "cheapModel",
      "enabled",
      "maxActions",
      "maxInputChars",
      "mediumModel",
      "mode",
    ]);
  });

  if (process.exitCode) {
    console.error("\nSome ai-router-config tests failed.");
  } else {
    console.log("\nAll ai-router-config tests passed.");
  }
}

run();
