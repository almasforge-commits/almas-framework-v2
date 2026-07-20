import assert from "node:assert/strict";

import { createConversationContextStore } from "../services/context/conversationContextStore.js";
import { createClarificationEngine } from "../services/context/clarificationEngine.js";
import { QUESTIONS } from "../services/context/contextContracts.js";
import {
  handleClarificationTurn,
  maybeStartClarificationFromAiDecision,
  maybeStartClarificationFromFinanceAttempt,
} from "../handlers/routes/clarificationRoute.js";

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

function makeRoute(overrides = {}) {
  const sent = [];
  let expenseCalls = 0;
  let incomeCalls = 0;
  let execCalls = 0;
  const store = createConversationContextStore();
  const engine =
    overrides.engine ||
    createClarificationEngine({
      store,
      parseFinanceFn: overrides.parseFinanceFn,
    });
  const deps = {
    engine,
    sendMessageFn: async (chatId, text) => {
      sent.push({ chatId, text });
    },
    executeActionsFn: async (actions) => {
      execCalls += 1;
      const action = actions[0];
      return {
        executedCount: 1,
        results: [
          {
            action,
            executed: true,
            reason:
              action.type === "task_create" ? "task_created" : "memory_saved",
          },
        ],
      };
    },
    addExpenseFn: async (row) => {
      expenseCalls += 1;
      return { id: "e1", ...row };
    },
    addIncomeFn: async (row) => {
      incomeCalls += 1;
      return { id: "i1", ...row };
    },
    aiRouterActiveFn: () => true,
    ...overrides,
    engine,
  };
  return { sent, store, engine, deps, counters: { expenseCalls: () => expenseCalls, incomeCalls: () => incomeCalls, execCalls: () => execCalls } };
}

async function run() {
  await test("task missing content → question; answer executes once", async () => {
    const { sent, deps, counters } = makeRoute();
    const actor = { actorKey: "telegram:1" };
    const from = { id: 1 };

    const start = await handleClarificationTurn(
      { chatId: 10, text: "Создай задачу", from, actor, requestKey: "t0" },
      deps
    );
    assert.equal(start.handled, true);
    assert.equal(sent[0].text, QUESTIONS.task_content);

    const done = await handleClarificationTurn(
      {
        chatId: 10,
        text: "Позвонить Арману",
        from,
        actor,
        requestKey: "t1",
      },
      deps
    );
    assert.equal(done.reason, "completed");
    assert.equal(counters.execCalls(), 1);
    assert.ok(sent.some((m) => /Задача сохранена/i.test(m.text)));
  });

  await test("memory missing content → question; answer executes once", async () => {
    const { sent, deps, counters } = makeRoute();
    const actor = { actorKey: "telegram:2" };
    await handleClarificationTurn(
      { chatId: 2, text: "Запомни", from: { id: 2 }, actor },
      deps
    );
    assert.equal(sent[0].text, QUESTIONS.memory_content);
    const done = await handleClarificationTurn(
      {
        chatId: 2,
        text: "Мне нравится работать ночью",
        from: { id: 2 },
        actor,
        requestKey: "m1",
      },
      deps
    );
    assert.equal(done.reason, "completed");
    assert.equal(counters.execCalls(), 1);
  });

  await test("finance missing both → ordered questions; legacy write once", async () => {
    const parseFinanceFn = (text) => {
      if (/Потратил 500/i.test(text) || text === "Потратил 500") {
        return { type: "expense", amount: 500, currency: "VND", description: "" };
      }
      return null;
    };
    const { sent, deps, counters } = makeRoute({ parseFinanceFn });
    // Rebind engine with parseFinanceFn
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
      parseFinanceFn,
    });
    deps.engine = engine;

    const actor = { actorKey: "telegram:3" };
    const started = await maybeStartClarificationFromFinanceAttempt(
      {
        chatId: 3,
        text: "Потратил 500",
        actor,
        parsed: parseFinanceFn("Потратил 500"),
      },
      { ...deps, aiRouterActiveFn: () => false }
    );
    assert.equal(started.handled, true);
    assert.equal(sent[0].text, QUESTIONS.finance_currency);

    await handleClarificationTurn(
      { chatId: 3, text: "USD", from: { id: 3 }, actor },
      deps
    );
    assert.equal(sent[1].text, QUESTIONS.finance_description);

    const done = await handleClarificationTurn(
      { chatId: 3, text: "кофе", from: { id: 3 }, actor, requestKey: "fin1" },
      deps
    );
    assert.equal(done.reason, "completed");
    assert.equal(counters.expenseCalls(), 1);
    assert.equal(counters.execCalls(), 0);
    assert.ok(sent.some((m) => /Расход сохранён/i.test(m.text)));
  });

  await test("finance works in shadow mode", async () => {
    const parseFinanceFn = () => ({
      type: "expense",
      amount: 100,
      currency: "VND",
      description: "",
    });
    const engine = createClarificationEngine({
      store: createConversationContextStore(),
      parseFinanceFn,
    });
    const { sent, deps } = makeRoute({
      engine,
      aiRouterActiveFn: () => false,
    });
    const started = await maybeStartClarificationFromFinanceAttempt(
      {
        chatId: 4,
        text: "Потратил 100",
        actor: { actorKey: "telegram:4" },
        parsed: parseFinanceFn(),
      },
      deps
    );
    assert.equal(started.handled, true);
    assert.equal(sent.length, 1);
  });

  await test("shadow skips task/memory clarification", async () => {
    const { sent, deps } = makeRoute({ aiRouterActiveFn: () => false });
    const result = await handleClarificationTurn(
      {
        chatId: 1,
        text: "Создай задачу",
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      deps
    );
    assert.equal(result.handled, false);
    assert.equal(result.reason, "shadow_skip_task_memory");
    assert.equal(sent.length, 0);
  });

  await test("active AI decision clarification", async () => {
    const { sent, deps } = makeRoute();
    const started = await maybeStartClarificationFromAiDecision(
      {
        chatId: 5,
        text: "задача",
        actor: { actorKey: "telegram:5" },
        decision: {
          needsClarification: true,
          actions: [{ type: "task_create", payload: { content: null } }],
          rejectedActions: [],
        },
      },
      deps
    );
    assert.equal(started.handled, true);
    assert.equal(sent[0].text, QUESTIONS.task_content);
  });

  await test("cancel message exact", async () => {
    const { sent, deps } = makeRoute();
    const actor = { actorKey: "telegram:6" };
    await handleClarificationTurn(
      { chatId: 6, text: "Запомни", from: { id: 6 }, actor },
      deps
    );
    const cancelled = await handleClarificationTurn(
      { chatId: 6, text: "не надо", from: { id: 6 }, actor },
      deps
    );
    assert.equal(cancelled.reason, "cancelled");
    assert.ok(sent.some((m) => m.text === "Операция отменена."));
  });

  await test("voice transcript same path", async () => {
    const { deps, counters } = makeRoute();
    const actor = { actorKey: "telegram:8" };
    await handleClarificationTurn(
      {
        chatId: 8,
        text: "Создай задачу",
        from: { id: 8 },
        actor,
        inputSource: "voice",
      },
      deps
    );
    const done = await handleClarificationTurn(
      {
        chatId: 8,
        text: "купить воду",
        from: { id: 8 },
        actor,
        inputSource: "voice",
        requestKey: "v1",
      },
      deps
    );
    assert.equal(done.reason, "completed");
    assert.equal(counters.execCalls(), 1);
  });

  await test("actor/chat isolation", async () => {
    const { deps } = makeRoute();
    await handleClarificationTurn(
      {
        chatId: 1,
        text: "Создай задачу",
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      deps
    );
    const otherActor = await handleClarificationTurn(
      {
        chatId: 1,
        text: "Позвонить",
        from: { id: 2 },
        actor: { actorKey: "telegram:2" },
      },
      deps
    );
    assert.equal(otherActor.handled, false);
    assert.ok(deps.engine.getPending("telegram:1", 1));

    const otherChat = await handleClarificationTurn(
      {
        chatId: 99,
        text: "Позвонить",
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      deps
    );
    assert.equal(otherChat.handled, false);
  });

  await test("duplicate requestKey does not double-execute", async () => {
    const { deps, counters } = makeRoute();
    const actor = { actorKey: "telegram:7" };
    await handleClarificationTurn(
      { chatId: 7, text: "Создай задачу", from: { id: 7 }, actor },
      deps
    );
    await handleClarificationTurn(
      {
        chatId: 7,
        text: "дело",
        from: { id: 7 },
        actor,
        requestKey: "same",
      },
      deps
    );
    const dup = await handleClarificationTurn(
      {
        chatId: 7,
        text: "дело",
        from: { id: 7 },
        actor,
        requestKey: "same",
      },
      deps
    );
    assert.equal(dup.reason, "duplicate");
    assert.equal(counters.execCalls(), 1);
  });

  console.log(`\nclarification-engine: ${passed} passed, ${failed} failed`);
}

run();
