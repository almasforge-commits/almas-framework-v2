import assert from "node:assert/strict";

import { shouldSaveMemory } from "../services/storage/memoryFilter.js";

// shouldSaveMemory() is pure/local — no OpenAI, no Supabase, no
// Telegram. This tests the Phase 5 "prevent command-like fallthrough
// into Memory" guard directly, using the exact examples from the
// milestone spec.

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

  test("failed finance-like input is not saved as Memory ('расход сорок тысяч кофе')", () => {
    assert.equal(shouldSaveMemory("расход сорок тысяч кофе"), false);
  });

  test("finance-like input that NOW parses successfully is still not saved as Memory ('Потратил на кофе сорок тысяч')", () => {
    assert.equal(shouldSaveMemory("Потратил на кофе сорок тысяч"), false);
  });

  test("a genuinely unparseable finance attempt is not saved as Memory", () => {
    assert.equal(shouldSaveMemory("расход какая-то сумма кофе"), false);
  });

  test("destructive command is not saved as Memory, with punctuation/case/space variants", () => {
    assert.equal(shouldSaveMemory("удалить все знания"), false);
    assert.equal(shouldSaveMemory("Удалить все знания."), false);
    assert.equal(shouldSaveMemory("удалить   все   знания!"), false);
    assert.equal(shouldSaveMemory("УДАЛИТЬ ВСЕ ЗНАНИЯ"), false);
  });

  test("destructive finance intent is not saved as Memory, with punctuation variants", () => {
    assert.equal(shouldSaveMemory("удали последнюю операцию"), false);
    assert.equal(shouldSaveMemory("Удали последнюю операцию."), false);
    assert.equal(shouldSaveMemory("удали последнюю транзакцию"), false);
    assert.equal(shouldSaveMemory("удали последний расход"), false);
    assert.equal(shouldSaveMemory("удали последний доход"), false);
  });

  test("search command is not saved as Memory ('найди '/'найти ')", () => {
    assert.equal(shouldSaveMemory("найди отчет по кофе"), false);
    assert.equal(shouldSaveMemory("найти книгу про RAG"), false);
  });

  test("chat/question command is not saved as Memory ('спроси что такое RAG')", () => {
    assert.equal(shouldSaveMemory("спроси что такое RAG"), false);
  });

  test("knowledge commands are not saved as Memory", () => {
    assert.equal(shouldSaveMemory("мои знания"), false);
    assert.equal(shouldSaveMemory("открыть 1"), false);
    assert.equal(shouldSaveMemory("покажи 2"), false);
  });

  test("task commands are not saved as Memory", () => {
    assert.equal(shouldSaveMemory("мои задачи"), false);
    assert.equal(shouldSaveMemory("выполнено 1"), false);
    assert.equal(shouldSaveMemory("выполненные задачи"), false);
  });

  test("balance/history/statistics commands are not saved as Memory", () => {
    assert.equal(shouldSaveMemory("баланс"), false);
    assert.equal(shouldSaveMemory("история"), false);
    assert.equal(shouldSaveMemory("статистика"), false);
    assert.equal(shouldSaveMemory("сколько потратил на кафе"), false);
    assert.equal(shouldSaveMemory("расходы за неделю"), false);
    assert.equal(shouldSaveMemory("аналитика"), false);
  });

  test("YouTube URLs are not saved as Memory", () => {
    assert.equal(shouldSaveMemory("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
  });

  test("meaningless short input is not saved as Memory ('4', punctuation, empty)", () => {
    assert.equal(shouldSaveMemory("4"), false);
    assert.equal(shouldSaveMemory("."), false);
    assert.equal(shouldSaveMemory("!"), false);
    assert.equal(shouldSaveMemory("   "), false);
  });

  test("commands that merely contain numbers remain ineligible as Memory, not blocked as short input alone", () => {
    assert.equal(shouldSaveMemory("открыть 4"), false);
    assert.equal(shouldSaveMemory("выполнено 4"), false);
    assert.equal(shouldSaveMemory("расход 40000 кофе"), false);
  });

  test("a normal note IS eligible for Memory ('Заметка: купить батарейки')", () => {
    assert.equal(shouldSaveMemory("Заметка: купить батарейки"), true);
  });

  test("a normal idea IS eligible for Memory ('У меня появилась идея сделать голосовой режим')", () => {
    assert.equal(
      shouldSaveMemory("У меня появилась идея сделать голосовой режим"),
      true
    );
  });

  test("Memory is not broadly disabled — an unrelated everyday sentence is still eligible", () => {
    assert.equal(shouldSaveMemory("сегодня был хороший день"), true);
    assert.equal(shouldSaveMemory("купить молоко и хлеб завтра"), true);
  });

  if (process.exitCode) {
    console.error("\nSome memory-routing-guard tests failed.");
  } else {
    console.log("\nAll memory-routing-guard tests passed.");
  }

}

run();
