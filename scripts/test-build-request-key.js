import assert from "node:assert/strict";

import { buildRequestKey } from "../core/utils/buildRequestKey.js";

// Pure, deterministic, no I/O — safe to run directly.

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
  test("message_id is the primary key: same chatId+messageId -> same key", () => {
    const a = buildRequestKey({ chatId: 1, messageId: 100, text: "hi" });
    const b = buildRequestKey({ chatId: 1, messageId: 100, text: "hi" });
    assert.equal(a, b);
    assert.match(a, /^msg:1:100$/);
  });

  test("different message_ids (even with identical text) produce different keys", () => {
    const a = buildRequestKey({ chatId: 1, messageId: 100, text: "same text" });
    const b = buildRequestKey({ chatId: 1, messageId: 101, text: "same text" });
    assert.notEqual(a, b);
  });

  test("different chatId with the same message_id produces different keys", () => {
    const a = buildRequestKey({ chatId: 1, messageId: 100, text: "hi" });
    const b = buildRequestKey({ chatId: 2, messageId: 100, text: "hi" });
    assert.notEqual(a, b);
  });

  test("hash fallback is used only when message_id is unavailable (null/undefined)", () => {
    const withoutId = buildRequestKey({ chatId: 1, text: "hello world" });
    assert.match(withoutId, /^hash:1:[0-9a-f]{16}$/);

    const explicitlyNull = buildRequestKey({ chatId: 1, messageId: null, text: "hello world" });
    assert.equal(explicitlyNull, withoutId);
  });

  test("hash fallback is deterministic for the same chatId+text", () => {
    const a = buildRequestKey({ chatId: 5, text: "same" });
    const b = buildRequestKey({ chatId: 5, text: "same" });
    assert.equal(a, b);
  });

  test("hash fallback differs for different text", () => {
    const a = buildRequestKey({ chatId: 5, text: "one" });
    const b = buildRequestKey({ chatId: 5, text: "two" });
    assert.notEqual(a, b);
  });

  test("missing chatId does not throw", () => {
    assert.doesNotThrow(() => buildRequestKey({ messageId: 1 }));
    assert.doesNotThrow(() => buildRequestKey({ text: "x" }));
    assert.doesNotThrow(() => buildRequestKey());
  });

  if (process.exitCode) {
    console.error("\nSome build-request-key tests failed.");
  } else {
    console.log("\nAll build-request-key tests passed.");
  }
}

run();
