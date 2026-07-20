import assert from "node:assert/strict";

const CONFIG_PATH = new URL("../config/inbox.js", import.meta.url).href;
const ENV_KEYS = [
  "INBOX_ENABLED",
  "INBOX_MODE",
  "INBOX_MAX_TEXT_CHARS",
  "INBOX_LIST_DEFAULT_LIMIT",
  "INBOX_MAX_METADATA_DEPTH",
  "INBOX_MAX_METADATA_KEYS",
];

const original = {};
for (const key of ENV_KEYS) original[key] = process.env[key];

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
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
  await test("defaults: enabled=false, mode=off", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = await freshImport();
    assert.equal(config.INBOX_ENABLED, false);
    assert.equal(config.INBOX_MODE, "off");
    assert.equal(config.isInboxEnabled(), false);
    assert.equal(config.INBOX_MAX_TEXT_CHARS, 12000);
    assert.equal(config.INBOX_LIST_DEFAULT_LIMIT, 50);
  });

  await test("invalid mode falls back to off", async () => {
    process.env.INBOX_MODE = "active";
    process.env.INBOX_ENABLED = "true";
    const config = await freshImport();
    assert.equal(config.INBOX_MODE, "off");
    assert.equal(config.isInboxEnabled(), false);
  });

  await test("invalid booleans handled safely", async () => {
    process.env.INBOX_ENABLED = "maybe";
    const config = await freshImport();
    assert.equal(config.INBOX_ENABLED, false);
  });

  await test("numeric limits validated (non-positive → default)", async () => {
    process.env.INBOX_MAX_TEXT_CHARS = "-5";
    process.env.INBOX_LIST_DEFAULT_LIMIT = "0";
    const config = await freshImport();
    assert.equal(config.INBOX_MAX_TEXT_CHARS, 12000);
    assert.equal(config.INBOX_LIST_DEFAULT_LIMIT, 50);
  });

  await test("enabled+shadow turns isInboxEnabled on", async () => {
    process.env.INBOX_ENABLED = "true";
    process.env.INBOX_MODE = "shadow";
    const config = await freshImport();
    assert.equal(config.isInboxEnabled(), true);
    const snapshot = config.getInboxConfig();
    assert.deepEqual(Object.keys(snapshot).sort(), [
      "enabled",
      "listDefaultLimit",
      "maxMetadataDepth",
      "maxMetadataKeys",
      "maxTextChars",
      "mode",
    ]);
  });

  if (process.exitCode) console.error("\nSome inbox-config tests failed.");
  else console.log("\nAll inbox-config tests passed.");
}

run();
