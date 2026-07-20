import assert from "node:assert/strict";

import { detectDeterministicIntent } from "../services/inbox/deterministicIntentDetector.js";

// Tier 0 — reuses existing pure parsers only, no OpenAI/Supabase/Telegram.

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
  test("clear digit-based expense is resolved deterministically (no AI needed)", () => {
    const result = detectDeterministicIntent("Потратил 40000 на кофе");
    assert.ok(result);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].type, "finance_expense");
    assert.equal(result.actions[0].payload.amount, 40000);
    assert.equal(result.reasonCode, "finance_parsed");
  });

  test("clear digit-based income is resolved deterministically", () => {
    const result = detectDeterministicIntent("Доход 2000000 зарплата");
    assert.ok(result);
    assert.equal(result.actions[0].type, "finance_income");
    assert.equal(result.actions[0].payload.amount, 2000000);
  });

  test("known YouTube URL is resolved deterministically as knowledge_query", () => {
    const result = detectDeterministicIntent("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.ok(result);
    assert.equal(result.actions[0].type, "knowledge_query");
    assert.equal(result.reasonCode, "youtube_link");
  });

  test("destructive typed command is resolved deterministically with requiresConfirmation:true", () => {
    const result = detectDeterministicIntent("удалить все знания");
    assert.ok(result);
    assert.equal(result.actions[0].type, "system_command");
    assert.equal(result.actions[0].payload.command, "delete_all_knowledge");
    assert.equal(result.actions[0].requiresConfirmation, true);
  });

  test("finance delete_last query intent is resolved deterministically as destructive", () => {
    const result = detectDeterministicIntent("удали последнюю операцию");
    assert.ok(result);
    assert.equal(result.actions[0].payload.command, "delete_last_transaction");
    assert.equal(result.actions[0].requiresConfirmation, true);
  });

  test("exact commands (баланс/история/статистика/мои задачи) resolve deterministically", () => {
    assert.equal(detectDeterministicIntent("баланс").actions[0].payload.command, "balance");
    assert.equal(detectDeterministicIntent("история").actions[0].payload.command, "history");
    assert.equal(detectDeterministicIntent("статистика").actions[0].payload.command, "statistics");
    assert.equal(detectDeterministicIntent("мои задачи").actions[0].payload.command, "list_active_tasks");
  });

  test("'спроси ...' resolves deterministically as chat with the extracted query", () => {
    const result = detectDeterministicIntent("спроси что такое RAG");
    assert.equal(result.actions[0].type, "chat");
    assert.equal(result.actions[0].payload.query, "что такое RAG");
  });

  test("finance-like text that fails to parse asks for clarification instead of escalating blindly", () => {
    const result = detectDeterministicIntent("расход какая-то сумма кофе");
    assert.ok(result);
    assert.equal(result.actions.length, 0);
    assert.equal(result.needsClarification, true);
    assert.equal(result.reasonCode, "unparsed_finance_attempt");
  });

  test("empty input resolves deterministically to 'unknown'", () => {
    const result = detectDeterministicIntent("   ");
    assert.equal(result.actions[0].type, "unknown");
  });

  test("finance phrase with a second glued-on action escalates to AI instead of a partial deterministic answer", () => {
    assert.equal(
      detectDeterministicIntent("Потратил 40000 на кофе и завтра купить батарейки"),
      null
    );
  });

  test("finance phrase with plain multi-item description (no second action) still resolves deterministically", () => {
    const result = detectDeterministicIntent("Потратил 40000 на кофе и печенье");
    assert.ok(result);
    assert.equal(result.actions[0].type, "finance_expense");
  });

  test("a natural conversational sentence with no clear rule returns null (escalates to AI)", () => {
    assert.equal(detectDeterministicIntent("Расскажи анекдот про кота"), null);
    assert.equal(detectDeterministicIntent("Запомни, что мне нравится это кафе"), null);
    assert.equal(detectDeterministicIntent("Завтра reminder купить батарейки"), null);
  });

  test("pure numeric / punctuation-only input is a final Tier-0 decision (no AI)", () => {
    assert.equal(detectDeterministicIntent("4")?.reasonCode, "meaningless_short_input");
    assert.equal(detectDeterministicIntent(".")?.reasonCode, "meaningless_short_input");
    assert.equal(detectDeterministicIntent("")?.reasonCode, "empty_input");
  });

  test("commands containing numbers are still recognized, not treated as meaningless short input", () => {
    assert.equal(detectDeterministicIntent("открыть 4")?.reasonCode, "prefix_command");
    assert.equal(detectDeterministicIntent("выполнено 4")?.reasonCode, "prefix_command");
    assert.equal(detectDeterministicIntent("расход 40000 кофе")?.reasonCode, "finance_parsed");
  });

  if (process.exitCode) {
    console.error("\nSome deterministic-intent-detector tests failed.");
  } else {
    console.log("\nAll deterministic-intent-detector tests passed.");
  }
}

run();
