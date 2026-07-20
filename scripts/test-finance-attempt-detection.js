import assert from "node:assert/strict";

import {
  looksLikeFinanceAttempt,
  parseFinanceMessage,
} from "../services/finance/financeParser.js";
import { parseFinanceMessages } from "../services/finance/financeMultiParser.js";
import { shouldSaveMemory } from "../services/storage/memoryFilter.js";

// All pure/local functions — no OpenAI, no Supabase, no Telegram. These
// tests exercise the exact decision inputs routeText() combines into
// `isUnparsedFinanceAttempt` and the Memory-save guard, without
// executing messageHandler.js itself (see test-message-router-extraction.js
// for the source-level wiring checks).
//
// NOTE: since the "Voice-first command intelligence" milestone,
// parseFinanceMessage() converts spelled-out Russian number words
// ("сорок тысяч") to digits internally via russianNumberParser.js — see
// test-russian-number-parser.js and test-finance-spoken-numbers.js for
// that. This file now only covers genuinely UNPARSEABLE finance-like
// text (no recognizable amount at all) plus the resulting Memory
// eligibility decision.

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

  test("looksLikeFinanceAttempt: recognizes a spelled-out amount as a finance attempt", () => {
    assert.equal(looksLikeFinanceAttempt("расход сорок тысяч кофе"), true);
  });

  test("parseFinanceMessage: now successfully parses a spelled-out amount (previously the reported bug)", () => {
    const result = parseFinanceMessage("расход сорок тысяч кофе");

    assert.ok(result, "Expected parseFinanceMessage to return a result");
    assert.equal(result.type, "expense");
    assert.equal(result.amount, 40000);
  });

  test("combined: 'расход сорок тысяч кофе' now reaches Finance directly (not an unparsed attempt)", () => {
    const text = "расход сорок тысяч кофе";
    const finance = parseFinanceMessage(text);
    const finances = parseFinanceMessages(text);
    const isUnparsedFinanceAttempt =
      !finance && finances.length === 0 && looksLikeFinanceAttempt(text);

    assert.ok(finance);
    assert.equal(isUnparsedFinanceAttempt, false);
  });

  test("parseFinanceMessage: a genuinely unparseable amount (no digits, no recognized number words) still fails", () => {
    assert.equal(parseFinanceMessage("расход какая-то сумма кофе"), null);
  });

  test("combined: a genuinely unparseable finance attempt is still not saved to Memory", () => {
    const text = "расход какая-то сумма кофе";
    const finance = parseFinanceMessage(text);
    const finances = parseFinanceMessages(text);
    const isUnparsedFinanceAttempt =
      !finance && finances.length === 0 && looksLikeFinanceAttempt(text);

    assert.equal(isUnparsedFinanceAttempt, true);
    assert.equal(shouldSaveMemory(text), false);
  });

  test("combined: 'расход 40000 кофе' reaches Finance (parses successfully, digits)", () => {
    const text = "расход 40000 кофе";
    const finance = parseFinanceMessage(text);

    assert.ok(finance, "Expected parseFinanceMessage to return a result");
    assert.equal(finance.type, "expense");
    assert.equal(finance.amount, 40000);

    const isUnparsedFinanceAttempt =
      !finance &&
      parseFinanceMessages(text).length === 0 &&
      looksLikeFinanceAttempt(text);

    assert.equal(isUnparsedFinanceAttempt, false);
  });

  test("combined: a normal note (not finance-like) is still eligible for Memory", () => {
    const text = "купить молоко и хлеб завтра";
    const finance = parseFinanceMessage(text);
    const finances = parseFinanceMessages(text);
    const isUnparsedFinanceAttempt =
      !finance && finances.length === 0 && looksLikeFinanceAttempt(text);

    assert.equal(isUnparsedFinanceAttempt, false);
    assert.equal(shouldSaveMemory(text), true);
  });

  test("looksLikeFinanceAttempt: plain non-finance text returns false", () => {
    assert.equal(looksLikeFinanceAttempt("купить молоко и хлеб завтра"), false);
  });

  test("looksLikeFinanceAttempt: empty/undefined input returns false", () => {
    assert.equal(looksLikeFinanceAttempt(""), false);
    assert.equal(looksLikeFinanceAttempt(undefined), false);
  });

  test("looksLikeFinanceAttempt: recognizes income words too, and the spelled-out amount now parses", () => {
    assert.equal(looksLikeFinanceAttempt("доход сто тысяч зарплата"), true);

    const result = parseFinanceMessage("доход сто тысяч зарплата");
    assert.ok(result);
    assert.equal(result.type, "income");
    assert.equal(result.amount, 100000);
  });

  if (process.exitCode) {
    console.error("\nSome finance-attempt-detection tests failed.");
  } else {
    console.log("\nAll finance-attempt-detection tests passed.");
  }

}

run();
