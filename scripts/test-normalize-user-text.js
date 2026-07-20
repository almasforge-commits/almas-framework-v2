import assert from "node:assert/strict";

import {
  normalizeUserText,
  normalizeCommandText,
} from "../core/utils/normalizeUserText.js";

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

  test("normalizeUserText: preserves original case", () => {
    assert.equal(normalizeUserText("Привет, Мир"), "Привет, Мир");
  });

  test("normalizeUserText: trims leading/trailing whitespace", () => {
    assert.equal(normalizeUserText("   привет   "), "привет");
  });

  test("normalizeUserText: collapses repeated internal whitespace", () => {
    assert.equal(normalizeUserText("привет    мир\n\nкак дела"), "привет мир как дела");
  });

  test("normalizeUserText: collapses repeated identical punctuation", () => {
    assert.equal(normalizeUserText("Ура!!!"), "Ура!");
    assert.equal(normalizeUserText("Правда???"), "Правда?");
  });

  test("normalizeUserText: never alters a single decimal/thousands separator (digits untouched)", () => {
    assert.equal(normalizeUserText("40000.50"), "40000.50");
    assert.equal(normalizeUserText("50 000,50"), "50 000,50");
    assert.equal(normalizeUserText("расход 40000, кофе"), "расход 40000, кофе");
  });

  test("normalizeUserText: supports Cyrillic without corrupting it", () => {
    assert.equal(normalizeUserText("Купить батарейки для игрушки"), "Купить батарейки для игрушки");
  });

  test("normalizeUserText: empty/whitespace-only input becomes empty string", () => {
    assert.equal(normalizeUserText(""), "");
    assert.equal(normalizeUserText("   "), "");
  });

  test("normalizeUserText: null/undefined input becomes empty string", () => {
    assert.equal(normalizeUserText(null), "");
    assert.equal(normalizeUserText(undefined), "");
  });

  test("normalizeUserText: deterministic (same input always produces same output)", () => {
    const input = "Потратил   на кофе!!! 40000,50";
    assert.equal(normalizeUserText(input), normalizeUserText(input));
  });

  test("normalizeUserText: does not mutate the original text reference use elsewhere (pure function)", () => {
    const original = "Заметка: купить батарейки";
    const normalized = normalizeUserText(original);
    assert.equal(original, "Заметка: купить батарейки");
    assert.notEqual(normalized, undefined);
  });

  test("normalizeCommandText: lowercases for matching", () => {
    assert.equal(normalizeCommandText("БАЛАНС"), "баланс");
  });

  test("normalizeCommandText: strips trailing '.', ',', '!', '?', ':', ';'", () => {
    assert.equal(normalizeCommandText("удалить все знания."), "удалить все знания");
    assert.equal(normalizeCommandText("удалить все знания,"), "удалить все знания");
    assert.equal(normalizeCommandText("удалить все знания!"), "удалить все знания");
    assert.equal(normalizeCommandText("удалить все знания?"), "удалить все знания");
    assert.equal(normalizeCommandText("удалить все знания:"), "удалить все знания");
    assert.equal(normalizeCommandText("удалить все знания;"), "удалить все знания");
  });

  test("normalizeCommandText: handles capitalization, trailing punctuation, and repeated spaces together", () => {
    assert.equal(
      normalizeCommandText("  УДАЛИТЬ   ВСЕ   ЗНАНИЯ!   "),
      "удалить все знания"
    );
  });

  test("normalizeCommandText: only strips TRAILING punctuation, not internal punctuation", () => {
    assert.equal(
      normalizeCommandText("расход 40000, кофе."),
      "расход 40000, кофе"
    );
  });

  test("normalizeCommandText: empty/undefined/whitespace-only input becomes empty string", () => {
    assert.equal(normalizeCommandText(""), "");
    assert.equal(normalizeCommandText(undefined), "");
    assert.equal(normalizeCommandText("   "), "");
  });

  if (process.exitCode) {
    console.error("\nSome normalizeUserText tests failed.");
  } else {
    console.log("\nAll normalizeUserText tests passed.");
  }

}

run();
