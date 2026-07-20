import assert from "node:assert/strict";

import { stripTrailingActionClause } from "../core/utils/stripTrailingActionClause.js";

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
  test("strips a trailing 'и завтра <task>' clause", () => {
    assert.equal(stripTrailingActionClause("кофе и завтра купить батарейки"), "кофе");
  });

  test("strips a trailing 'и купить <x>' clause", () => {
    assert.equal(stripTrailingActionClause("продукты и купить хлеб"), "продукты");
  });

  test("leaves a genuine multi-item description untouched (no task trigger word)", () => {
    assert.equal(stripTrailingActionClause("кофе и печенье"), "кофе и печенье");
  });

  test("leaves a description with no ' и ' untouched", () => {
    assert.equal(stripTrailingActionClause("кофе"), "кофе");
  });

  test("handles empty/null/undefined input without throwing", () => {
    assert.equal(stripTrailingActionClause(""), "");
    assert.equal(stripTrailingActionClause(null), null);
    assert.equal(stripTrailingActionClause(undefined), undefined);
  });

  test("never returns an empty string when the head would be empty (defensive fallback to original)", () => {
    assert.equal(stripTrailingActionClause("и завтра купить батарейки"), "и завтра купить батарейки");
  });

  test("is case-insensitive for the trigger word", () => {
    assert.equal(stripTrailingActionClause("кофе и ЗАВТРА купить батарейки"), "кофе");
  });

  if (process.exitCode) {
    console.error("\nSome strip-trailing-action-clause tests failed.");
  } else {
    console.log("\nAll strip-trailing-action-clause tests passed.");
  }
}

run();
