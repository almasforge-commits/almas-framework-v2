import assert from "node:assert/strict";

import { normalizeForRouting } from "../services/inbox/inputNormalizer.js";

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
  test("preserves the original input alongside the normalized text", () => {
    const result = normalizeForRouting("  Привет   МИР!!  ");
    assert.equal(result.original, "  Привет   МИР!!  ");
    assert.equal(result.normalized, "Привет МИР!");
  });

  test("defaults inputSource to 'text'", () => {
    const result = normalizeForRouting("hi");
    assert.equal(result.inputSource, "text");
  });

  test("honors an explicit inputSource of 'voice'", () => {
    const result = normalizeForRouting("hi", { inputSource: "voice" });
    assert.equal(result.inputSource, "voice");
  });

  test("truncates very long input to maxChars and flags truncated:true", () => {
    const longText = "a".repeat(100);
    const result = normalizeForRouting(longText, { maxChars: 10 });
    assert.equal(result.normalized.length, 10);
    assert.equal(result.truncated, true);
    // Original is preserved in full, untruncated.
    assert.equal(result.original.length, 100);
  });

  test("short input is not marked truncated", () => {
    const result = normalizeForRouting("short text", { maxChars: 6000 });
    assert.equal(result.truncated, false);
  });

  test("handles null/undefined input without throwing", () => {
    assert.doesNotThrow(() => normalizeForRouting(null));
    assert.doesNotThrow(() => normalizeForRouting(undefined));
    assert.equal(normalizeForRouting(null).normalized, "");
  });

  if (process.exitCode) {
    console.error("\nSome input-normalizer tests failed.");
  } else {
    console.log("\nAll input-normalizer tests passed.");
  }
}

run();
