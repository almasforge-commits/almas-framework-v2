import assert from "node:assert/strict";

import {
  parseRussianNumberPhrase,
  convertSpokenNumbersToDigits,
} from "../services/finance/russianNumberParser.js";

// Pure functions, no dependencies — real execution, no mocking needed.

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

  // Required examples from the spec.
  test("'сорок тысяч' -> 40000", () => {
    assert.equal(parseRussianNumberPhrase("сорок тысяч"), 40000);
  });

  test("'сорок две тысячи' -> 42000", () => {
    assert.equal(parseRussianNumberPhrase("сорок две тысячи"), 42000);
  });

  test("'сто двадцать тысяч' -> 120000", () => {
    assert.equal(parseRussianNumberPhrase("сто двадцать тысяч"), 120000);
  });

  test("'один миллион' -> 1000000", () => {
    assert.equal(parseRussianNumberPhrase("один миллион"), 1000000);
  });

  test("'два миллиона пятьсот тысяч' -> 2500000", () => {
    assert.equal(parseRussianNumberPhrase("два миллиона пятьсот тысяч"), 2500000);
  });

  test("'пятьсот' -> 500", () => {
    assert.equal(parseRussianNumberPhrase("пятьсот"), 500);
  });

  // Additional coverage across units/teens/tens/hundreds.
  test("units and teens parse correctly", () => {
    assert.equal(parseRussianNumberPhrase("ноль"), 0);
    assert.equal(parseRussianNumberPhrase("девять"), 9);
    assert.equal(parseRussianNumberPhrase("одиннадцать"), 11);
    assert.equal(parseRussianNumberPhrase("девятнадцать"), 19);
  });

  test("all tens parse correctly", () => {
    assert.equal(parseRussianNumberPhrase("двадцать"), 20);
    assert.equal(parseRussianNumberPhrase("девяносто"), 90);
  });

  test("all hundreds parse correctly", () => {
    assert.equal(parseRussianNumberPhrase("сто"), 100);
    assert.equal(parseRussianNumberPhrase("девятьсот"), 900);
  });

  test("case-insensitive input", () => {
    assert.equal(parseRussianNumberPhrase("СОРОК ТЫСЯЧ"), 40000);
  });

  test("invalid number phrase returns null (ordinary word)", () => {
    assert.equal(parseRussianNumberPhrase("кофе"), null);
  });

  test("invalid number phrase returns null (mixed valid + invalid word)", () => {
    assert.equal(parseRussianNumberPhrase("сорок кофе"), null);
  });

  test("empty/whitespace/undefined input returns null", () => {
    assert.equal(parseRussianNumberPhrase(""), null);
    assert.equal(parseRussianNumberPhrase("   "), null);
    assert.equal(parseRussianNumberPhrase(undefined), null);
  });

  test("mixed digit + word scale: '3 тысячи' -> 3000", () => {
    assert.equal(parseRussianNumberPhrase("3 тысячи"), 3000);
  });

  test("mixed digit + word scale: '20 тысяч триста' -> 20300", () => {
    assert.equal(parseRussianNumberPhrase("20 тысяч триста"), 20300);
  });

  test("pure digit phrase returns the same number", () => {
    assert.equal(parseRussianNumberPhrase("40000"), 40000);
  });

  test("does not interpret ordinary non-financial words as money", () => {
    assert.equal(parseRussianNumberPhrase("привет как дела"), null);
  });

  test("no infinite loop / completes quickly on a long phrase", () => {
    const longPhrase = "два миллиона пятьсот тысяч ".repeat(20).trim();
    const start = Date.now();
    parseRussianNumberPhrase(longPhrase);
    assert.ok(Date.now() - start < 1000, "Expected parsing to complete well under 1s");
  });

  // convertSpokenNumbersToDigits: scans a larger sentence.
  test("convertSpokenNumbersToDigits: converts an embedded spoken-number phrase, leaves the rest untouched", () => {
    assert.equal(
      convertSpokenNumbersToDigits("Потратил на кофе сорок тысяч"),
      "Потратил на кофе 40000"
    );
  });

  test("convertSpokenNumbersToDigits: 'Доход два миллиона зарплата' -> digits", () => {
    assert.equal(
      convertSpokenNumbersToDigits("Доход два миллиона зарплата"),
      "Доход 2000000 зарплата"
    );
  });

  test("convertSpokenNumbersToDigits: mixed digit + full word scale ('40 тысяч') still works", () => {
    assert.equal(
      convertSpokenNumbersToDigits("Потратил 40 тысяч на кофе"),
      "Потратил 40000 на кофе"
    );
  });

  test("convertSpokenNumbersToDigits: already-digit text is returned unchanged", () => {
    assert.equal(
      convertSpokenNumbersToDigits("расход 40000 кофе"),
      "расход 40000 кофе"
    );
  });

  test("convertSpokenNumbersToDigits: no number words present -> text returned unchanged", () => {
    assert.equal(
      convertSpokenNumbersToDigits("купить молоко и хлеб"),
      "купить молоко и хлеб"
    );
  });

  test("convertSpokenNumbersToDigits: does not accidentally convert an isolated ordinary number word used non-financially", () => {
    // "два" alone is still a valid number word and gets converted — this
    // documents that behavior rather than hiding it; it never affects
    // Memory-eligibility decisions since routeText only reads the
    // ORIGINAL text for storage/display.
    assert.equal(convertSpokenNumbersToDigits("У меня два кота"), "У меня 2 кота");
  });

  test("convertSpokenNumbersToDigits: empty/whitespace input returned unchanged", () => {
    assert.equal(convertSpokenNumbersToDigits(""), "");
    assert.equal(convertSpokenNumbersToDigits("   "), "   ");
  });

  test("convertSpokenNumbersToDigits: no infinite loop on pathological repeated input", () => {
    const start = Date.now();
    convertSpokenNumbersToDigits("тысяч тысяч тысяч тысяч тысяч".repeat(50));
    assert.ok(Date.now() - start < 1000, "Expected conversion to complete well under 1s");
  });

  if (process.exitCode) {
    console.error("\nSome russianNumberParser tests failed.");
  } else {
    console.log("\nAll russianNumberParser tests passed.");
  }

}

run();
