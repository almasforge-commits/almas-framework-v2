import assert from "node:assert/strict";

import {
  QUESTIONS,
  buildContextKey,
  createPendingClarification,
  detectIncompleteIntent,
  hasExplicitCurrency,
  isCancelClarificationPhrase,
  isDestructiveClarificationAnswer,
  missingFinanceClarificationFields,
  nextMissingField,
  parseCurrencyAnswer,
  questionForMissingFields,
} from "../services/context/contextContracts.js";
import { createConversationContextStore } from "../services/context/conversationContextStore.js";
import { createClarificationEngine } from "../services/context/clarificationEngine.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`✅ ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

async function run() {
  await test("buildContextKey is actor+chat", () => {
    assert.equal(buildContextKey("telegram:1", 42), "telegram:1::42");
  });

  await test("exact Russian questions", () => {
    assert.equal(QUESTIONS.task_content, "Что нужно сделать?");
    assert.equal(QUESTIONS.memory_content, "Что нужно запомнить?");
    assert.equal(QUESTIONS.finance_currency, "В какой валюте была операция?");
    assert.equal(
      QUESTIONS.finance_description,
      "На что были потрачены деньги?"
    );
    assert.equal(
      questionForMissingFields("task_create", ["content"]),
      QUESTIONS.task_content
    );
    assert.equal(
      questionForMissingFields("memory_save", ["content"]),
      QUESTIONS.memory_content
    );
  });

  await test("finance asks currency then description", () => {
    assert.equal(
      nextMissingField("finance_expense", ["currency", "description"]),
      "currency"
    );
    assert.equal(
      questionForMissingFields("finance_expense", ["currency", "description"]),
      QUESTIONS.finance_currency
    );
    assert.equal(
      questionForMissingFields("finance_expense", ["description"]),
      QUESTIONS.finance_description
    );
  });

  await test("detectIncompleteIntent task/memory", () => {
    const task = detectIncompleteIntent("Создай задачу");
    assert.equal(task?.kind, "task_create");
    assert.equal(task?.question, QUESTIONS.task_content);
    const memory = detectIncompleteIntent("Запомни");
    assert.equal(memory?.kind, "memory_save");
    assert.equal(memory?.question, QUESTIONS.memory_content);
    assert.equal(detectIncompleteIntent("создай задачу позвонить"), null);
  });

  await test("cancel / destructive phrases", () => {
    assert.equal(isCancelClarificationPhrase("не надо"), true);
    assert.equal(isCancelClarificationPhrase("отмена"), true);
    assert.equal(isCancelClarificationPhrase("stop"), true);
    assert.equal(isCancelClarificationPhrase("забудь"), false);
    assert.equal(isDestructiveClarificationAnswer("удалить все знания"), true);
  });

  await test("store get/set/update/clear/expire + requestKey idempotency", () => {
    const store = createConversationContextStore({ maxEntries: 10 });
    const pending = createPendingClarification({
      actorKey: "telegram:1",
      chatId: 10,
      kind: "task_create",
      missingFields: ["content"],
    });
    store.set(pending);
    assert.equal(store.get("telegram:1", 10)?.kind, "task_create");
    store.update("telegram:1", 10, { question: "updated" });
    assert.equal(store.get("telegram:1", 10)?.question, "updated");
    store.expire("telegram:1", 10);
    assert.equal(store.get("telegram:1", 10), null);
    store.markProcessedRequestKey("rk-1");
    assert.equal(store.hasProcessedRequestKey("rk-1"), true);
  });

  await test("no cross-actor / cross-chat leakage", () => {
    const store = createConversationContextStore();
    store.set(
      createPendingClarification({
        actorKey: "telegram:1",
        chatId: 1,
        kind: "task_create",
        missingFields: ["content"],
      })
    );
    assert.equal(store.get("telegram:2", 1), null);
    assert.equal(store.get("telegram:1", 2), null);
  });

  await test("TTL expire clears pending", () => {
    let now = 1_000_000;
    const store = createConversationContextStore();
    store.set(
      createPendingClarification({
        actorKey: "telegram:1",
        chatId: 1,
        kind: "task_create",
        missingFields: ["content"],
        nowMs: now,
        ttlMs: 100,
      })
    );
    assert.ok(store.get("telegram:1", 1, now + 50));
    assert.equal(store.get("telegram:1", 1, now + 101), null);
  });

  await test("task merge + unresolved temporal phrase", () => {
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
    });
    engine.startFromIncompleteIntent({
      text: "Создай задачу",
      actorKey: "telegram:1",
      chatId: 7,
    });
    const done = engine.handleAnswer({
      actorKey: "telegram:1",
      chatId: 7,
      answerText: "Позвонить Арману",
      requestKey: "a1",
    });
    assert.equal(done.status, "complete");
    assert.equal(done.draft.payload.content, "Позвонить Арману");

    // Later follow-up while content already on draft: phrase only, no ISO invent.
    engine.start({
      actorKey: "telegram:1",
      chatId: 7,
      kind: "task_create",
      missingFields: ["content"],
      draft: {
        type: "task_create",
        payload: { content: "Позвонить Арману" },
      },
    });
    const temporal = engine.handleAnswer({
      actorKey: "telegram:1",
      chatId: 7,
      answerText: "Завтра",
      requestKey: "a2",
    });
    assert.equal(temporal.status, "complete");
    assert.equal(temporal.draft.payload.content, "Позвонить Арману");
    assert.equal(temporal.draft.payload.unresolvedTemporal, "Завтра");
  });

  await test("finance missing both → currency then description", () => {
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
      parseFinanceFn: () => ({
        type: "expense",
        amount: 500,
        currency: "VND",
        description: "",
      }),
    });
    const started = engine.startFromIncompleteFinance({
      text: "Потратил 500",
      actorKey: "telegram:1",
      chatId: 3,
    });
    assert.ok(started);
    assert.equal(started.question, QUESTIONS.finance_currency);
    assert.deepEqual(started.missingFields, ["currency", "description"]);

    const afterCurrency = engine.handleAnswer({
      actorKey: "telegram:1",
      chatId: 3,
      answerText: "VND",
    });
    assert.equal(afterCurrency.status, "still_missing");
    assert.equal(afterCurrency.question, QUESTIONS.finance_description);

    const done = engine.handleAnswer({
      actorKey: "telegram:1",
      chatId: 3,
      answerText: "кофе",
      requestKey: "f1",
    });
    assert.equal(done.status, "complete");
    assert.equal(done.draft.payload.currency, "VND");
    assert.equal(done.draft.payload.description, "кофе");
    assert.equal(done.draft.payload.amount, 500);
  });

  await test("missingFinanceClarificationFields + hasExplicitCurrency", () => {
    assert.equal(hasExplicitCurrency("Потратил 500"), false);
    assert.equal(hasExplicitCurrency("Потратил 500 VND"), true);
    assert.equal(parseCurrencyAnswer("доллары"), "USD");
    const missing = missingFinanceClarificationFields(
      { type: "expense", amount: 500, currency: "VND", description: "" },
      "Потратил 500"
    );
    assert.deepEqual(missing, ["currency", "description"]);
  });

  await test("cancel clears; expired ignores stale", () => {
    let now = 10_000;
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
      nowFn: () => now,
    });
    engine.startFromIncompleteIntent({
      text: "запомни",
      actorKey: "telegram:9",
      chatId: 9,
    });
    assert.equal(
      engine.handleAnswer({
        actorKey: "telegram:9",
        chatId: 9,
        answerText: "отмена",
      }).status,
      "cancelled"
    );

    engine.start({
      actorKey: "telegram:1",
      chatId: 1,
      kind: "task_create",
      missingFields: ["content"],
      ttlMs: 50,
    });
    now += 100;
    assert.equal(
      engine.handleAnswer({
        actorKey: "telegram:1",
        chatId: 1,
        answerText: "что-то",
      }).status,
      "expired"
    );
  });

  await test("destructive + meaningless do not satisfy fields", () => {
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
    });
    engine.startFromIncompleteIntent({
      text: "создай задачу",
      actorKey: "telegram:1",
      chatId: 1,
    });
    assert.equal(
      engine.handleAnswer({
        actorKey: "telegram:1",
        chatId: 1,
        answerText: "удалить все знания",
      }).status,
      "rejected"
    );
    assert.equal(
      engine.handleAnswer({
        actorKey: "telegram:1",
        chatId: 1,
        answerText: "42",
      }).status,
      "rejected"
    );
    assert.ok(engine.getPending("telegram:1", 1));
  });

  await test("duplicate requestKey does not complete twice", () => {
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
    });
    engine.startFromIncompleteIntent({
      text: "создай задачу",
      actorKey: "telegram:1",
      chatId: 1,
    });
    const first = engine.handleAnswer({
      actorKey: "telegram:1",
      chatId: 1,
      answerText: "Купить воду",
      requestKey: "dup-1",
    });
    assert.equal(first.status, "complete");
    engine.startFromIncompleteIntent({
      text: "создай задачу",
      actorKey: "telegram:1",
      chatId: 1,
    });
    const second = engine.handleAnswer({
      actorKey: "telegram:1",
      chatId: 1,
      answerText: "Другое",
      requestKey: "dup-1",
    });
    assert.equal(second.status, "duplicate");
  });

  console.log(`\nconversation-context: ${passed} passed, ${failed} failed`);
}

run();
