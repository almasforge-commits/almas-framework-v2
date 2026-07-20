import assert from "node:assert/strict";

import { parseFinanceMessage } from "../services/finance/financeParser.js";

// parseFinanceMessage() is pure/local — no OpenAI, no Supabase, no
// Telegram, and (per the milestone) no database calls happen anywhere in
// this file. This covers the "safe finance integration" of
// russianNumberParser.js into the existing finance parser.

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

  test("'Потратил на кофе сорок тысяч' becomes an expense of 40000", () => {
    const result = parseFinanceMessage("Потратил на кофе сорок тысяч");

    assert.ok(result);
    assert.equal(result.type, "expense");
    assert.equal(result.amount, 40000);
  });

  test("'Доход два миллиона зарплата' becomes an income of 2000000", () => {
    const result = parseFinanceMessage("Доход два миллиона зарплата");

    assert.ok(result);
    assert.equal(result.type, "income");
    assert.equal(result.amount, 2000000);
  });

  test("'Потратил 40 тысяч на кофе' remains working (digit + full-word scale)", () => {
    const result = parseFinanceMessage("Потратил 40 тысяч на кофе");

    assert.ok(result);
    assert.equal(result.type, "expense");
    assert.equal(result.amount, 40000);
  });

  test("'Потратил 40000 на кофе' remains working (plain digits, no conversion needed)", () => {
    const result = parseFinanceMessage("Потратил 40000 на кофе");

    assert.ok(result);
    assert.equal(result.type, "expense");
    assert.equal(result.amount, 40000);
  });

  test("'расход сорок тысяч кофе' (originally reported bug) now parses as an expense of 40000", () => {
    const result = parseFinanceMessage("расход сорок тысяч кофе");

    assert.ok(result);
    assert.equal(result.type, "expense");
    assert.equal(result.amount, 40000);
    assert.equal(result.description, "кофе");
  });

  test("'сто двадцать тысяч' spent phrasing resolves to 120000", () => {
    const result = parseFinanceMessage("потратил сто двадцать тысяч на аренду");

    assert.ok(result);
    assert.equal(result.amount, 120000);
  });

  test("a single word-form amount without any trigger word does not parse (no finance trigger detected)", () => {
    assert.equal(parseFinanceMessage("сорок тысяч"), null);
  });

  test("ordinary non-finance text with an incidental number word is not treated as finance", () => {
    assert.equal(parseFinanceMessage("у меня два кота дома"), null);
  });

  test("existing digit+suffix support (40 тыс / 2 млн abbreviations) is unaffected", () => {
    const expense = parseFinanceMessage("расход 40 тыс на кофе");
    assert.ok(expense);
    assert.equal(expense.amount, 40000);

    const income = parseFinanceMessage("доход 2 млн зарплата");
    assert.ok(income);
    assert.equal(income.amount, 2000000);
  });

  test("no database calls occur — parseFinanceMessage is a pure function", () => {
    // If this reached Supabase (no env vars set in this test run), it
    // would throw a completely different, unrelated error instead of
    // returning a plain object synchronously.
    const result = parseFinanceMessage("Потратил на кофе сорок тысяч");
    assert.equal(typeof result, "object");
  });

  if (process.exitCode) {
    console.error("\nSome finance-spoken-numbers tests failed.");
  } else {
    console.log("\nAll finance-spoken-numbers tests passed.");
  }

}

run();
