import assert from "node:assert/strict";

import { normalizeCommandText } from "../core/utils/normalizeCommandText.js";

// Pure function, no dependencies — real execution, no mocking needed.

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

  test("lowercases and returns plain text unchanged in shape", () => {
    assert.equal(normalizeCommandText("баланс"), "баланс");
  });

  test("destructive command with trailing period, capitalized (reported bug)", () => {
    assert.equal(normalizeCommandText("Удалить все знания."), "удалить все знания");
  });

  test("destructive command with trailing exclamation mark", () => {
    assert.equal(normalizeCommandText("удалить все знания!"), "удалить все знания");
  });

  test("destructive command with trailing question mark", () => {
    assert.equal(normalizeCommandText("Удалить все знания?"), "удалить все знания");
  });

  test("destructive command with multiple trailing punctuation marks", () => {
    assert.equal(normalizeCommandText("удалить все знания?!"), "удалить все знания");
  });

  test("destructive command with extra internal and surrounding whitespace", () => {
    assert.equal(
      normalizeCommandText("  Удалить   все    знания  "),
      "удалить все знания"
    );
  });

  test("mixed case with punctuation and extra spaces combined", () => {
    assert.equal(
      normalizeCommandText("  УДАЛИТЬ   Все Знания !  "),
      "удалить все знания"
    );
  });

  test("does not strip internal/meaningful punctuation, only trailing", () => {
    assert.equal(
      normalizeCommandText("расход 40000, кофе."),
      "расход 40000, кофе"
    );
  });

  test("empty string stays empty", () => {
    assert.equal(normalizeCommandText(""), "");
  });

  test("undefined defaults to empty string", () => {
    assert.equal(normalizeCommandText(undefined), "");
  });

  test("whitespace-only input becomes empty", () => {
    assert.equal(normalizeCommandText("   "), "");
  });

  if (process.exitCode) {
    console.error("\nSome normalizeCommandText tests failed.");
  } else {
    console.log("\nAll normalizeCommandText tests passed.");
  }

}

run();
