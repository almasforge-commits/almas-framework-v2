import assert from "node:assert/strict";

import { parseFinanceMessage } from "../services/finance/financeParser.js";

// End-to-end check (via the real, unmodified parseFinanceMessage()) that
// a mixed Finance+Task message's Finance description no longer leaks
// the second (AI-owned) action clause. No database/network access —
// parseFinanceMessage() is a pure parser.

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
  test("'Потратил 40000 на кофе и завтра купить батарейки' -> description is exactly 'кофе'", () => {
    const finance = parseFinanceMessage("Потратил 40000 на кофе и завтра купить батарейки");
    assert.ok(finance, "Expected parseFinanceMessage to return a result");
    assert.equal(finance.type, "expense");
    assert.equal(finance.amount, 40000);
    assert.equal(finance.description, "кофе");
  });

  test("a normal single-purpose expense is unaffected", () => {
    const finance = parseFinanceMessage("Потратил 40000 на кофе");
    assert.equal(finance.description, "кофе");
  });

  test("a genuine multi-item description (no task trigger word) is preserved", () => {
    const finance = parseFinanceMessage("Потратил 40000 на кофе и печенье");
    assert.equal(finance.description, "кофе и печенье");
  });

  test("income messages get the same cleanup", () => {
    const finance = parseFinanceMessage("Доход 2000000 подарок и завтра позвонить в банк");
    assert.equal(finance.type, "income");
    assert.equal(finance.description, "подарок");
  });

  if (process.exitCode) {
    console.error("\nSome finance-description-cleanup tests failed.");
  } else {
    console.log("\nAll finance-description-cleanup tests passed.");
  }
}

run();
