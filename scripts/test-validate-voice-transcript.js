import assert from "node:assert/strict";

import { isPlausibleRussianTranscript } from "../core/utils/validateVoiceTranscript.js";

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

  test("normal Russian transcript passes", () => {
    assert.equal(isPlausibleRussianTranscript("расход сорок тысяч кофе"), true);
  });

  test("normal Russian sentence with punctuation passes", () => {
    assert.equal(isPlausibleRussianTranscript("Привет, как дела?"), true);
  });

  test("short Russian command passes regardless of length", () => {
    assert.equal(isPlausibleRussianTranscript("баланс"), true);
    assert.equal(isPlausibleRussianTranscript("да"), true);
  });

  test("Russian transcript with digits passes", () => {
    assert.equal(isPlausibleRussianTranscript("расход 40000 кофе"), true);
  });

  test("Georgian-script garbage is rejected (reported bug)", () => {
    assert.equal(isPlausibleRussianTranscript("შიჵმხტი მუემიში"), false);
  });

  test("Latin-script text is rejected (wrong language)", () => {
    assert.equal(isPlausibleRussianTranscript("the cat sat on the mat"), false);
  });

  test("empty transcript is rejected", () => {
    assert.equal(isPlausibleRussianTranscript(""), false);
  });

  test("whitespace-only transcript is rejected", () => {
    assert.equal(isPlausibleRussianTranscript("   "), false);
  });

  test("null/undefined transcript is rejected", () => {
    assert.equal(isPlausibleRussianTranscript(null), false);
    assert.equal(isPlausibleRussianTranscript(undefined), false);
  });

  test("pure digits with no letters is accepted (a bare spoken amount)", () => {
    assert.equal(isPlausibleRussianTranscript("40000"), true);
  });

  test("symbols/punctuation only, no letters or digits, is rejected", () => {
    assert.equal(isPlausibleRussianTranscript("... !? —"), false);
  });

  test("mostly non-Cyrillic with a couple of stray Cyrillic letters is rejected", () => {
    assert.equal(isPlausibleRussianTranscript("asdkjqwe про xyzabc"), false);
  });

  test("majority-Cyrillic text with a minor foreign word mixed in still passes", () => {
    assert.equal(isPlausibleRussianTranscript("купи кофе please сегодня"), true);
  });

  test("Russian sentence containing an English brand name passes", () => {
    assert.equal(isPlausibleRussianTranscript("Заказал кофе в Starbucks"), true);
    assert.equal(isPlausibleRussianTranscript("Купил новый iPhone вчера"), true);
  });

  test("Russian sentence containing a URL passes", () => {
    assert.equal(
      isPlausibleRussianTranscript("зайди на сайт example.com пожалуйста"),
      true
    );
  });

  test("Russian sentence containing a currency code passes", () => {
    assert.equal(isPlausibleRussianTranscript("получил сто USD от клиента"), true);
  });

  if (process.exitCode) {
    console.error("\nSome validateVoiceTranscript tests failed.");
  } else {
    console.log("\nAll validateVoiceTranscript tests passed.");
  }

}

run();
