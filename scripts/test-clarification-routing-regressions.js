/**
 * Routing-level regressions for Clarification Engine integration points.
 * Does not start the bot; injects fakes only.
 */
import assert from "node:assert/strict";

import { isMenuNavigationCommand } from "../core/utils/menuNavigationCommands.js";
import { isMeaninglessShortInput } from "../core/utils/isMeaninglessShortInput.js";
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

function makeDeps(overrides = {}) {
  const sent = [];
  const store = createConversationContextStore();
  const engine = createClarificationEngine({
    store,
    parseFinanceFn: overrides.parseFinanceFn,
  });
  return {
    sent,
    engine,
    deps: {
      engine,
      sendMessageFn: async (_chatId, text) => {
        sent.push(text);
      },
      executeActionsFn: async () => ({
        executedCount: 1,
        results: [
          {
            action: { type: "task_create", payload: { content: "x" } },
            executed: true,
            reason: "task_created",
          },
        ],
      }),
      addExpenseFn: async (row) => row,
      addIncomeFn: async (row) => row,
      aiRouterActiveFn: () => true,
      ...overrides,
      engine,
    },
  };
}

async function run() {
  await test("menu labels bypass clarification (precondition)", () => {
    assert.equal(isMenuNavigationCommand("меню"), true);
    assert.equal(isMenuNavigationCommand("/start"), true);
    assert.equal(isMenuNavigationCommand("📚 знания"), true);
  });

  await test("meaningless short input does not complete pending", async () => {
    assert.equal(isMeaninglessShortInput("42"), true);
    const { deps, sent, engine } = makeDeps();
    engine.startFromIncompleteIntent({
      text: "создай задачу",
      actorKey: "telegram:1",
      chatId: 1,
    });
    const result = await handleClarificationTurn(
      {
        chatId: 1,
        text: "42",
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      deps
    );
    assert.equal(result.handled, true);
    assert.equal(result.reason, "rejected");
    assert.equal(sent.at(-1), QUESTIONS.task_content);
    assert.ok(engine.getPending("telegram:1", 1));
  });

  await test("destructive answer cannot complete pending", async () => {
    const { deps, sent, engine } = makeDeps();
    engine.startFromIncompleteIntent({
      text: "создай задачу",
      actorKey: "telegram:1",
      chatId: 1,
    });
    const result = await handleClarificationTurn(
      {
        chatId: 1,
        text: "удалить все знания",
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      deps
    );
    assert.equal(result.reason, "rejected");
    assert.ok(engine.getPending("telegram:1", 1));
    assert.equal(sent.at(-1), QUESTIONS.task_content);
  });

  await test("shadow: AI-only clarification skipped", async () => {
    const { deps, sent } = makeDeps({ aiRouterActiveFn: () => false });
    const result = await maybeStartClarificationFromAiDecision(
      {
        chatId: 1,
        text: "сделай что-нибудь",
        actor: { actorKey: "telegram:1" },
        decision: {
          needsClarification: true,
          actions: [{ type: "task_create", payload: {} }],
        },
      },
      deps
    );
    assert.equal(result.handled, false);
    assert.equal(sent.length, 0);
  });

  await test("active: AI-only clarification starts", async () => {
    const { deps, sent } = makeDeps({ aiRouterActiveFn: () => true });
    const result = await maybeStartClarificationFromAiDecision(
      {
        chatId: 1,
        text: "сделай что-нибудь",
        actor: { actorKey: "telegram:1" },
        decision: {
          needsClarification: true,
          actions: [{ type: "task_create", payload: { content: null } }],
          rejectedActions: [],
        },
      },
      deps
    );
    assert.equal(result.handled, true);
    assert.equal(sent[0], QUESTIONS.task_content);
  });

  await test("provider failure style: missing decision falls back", async () => {
    const { deps, sent } = makeDeps();
    const result = await maybeStartClarificationFromAiDecision(
      {
        chatId: 1,
        text: "x",
        actor: { actorKey: "telegram:1" },
        decision: null,
      },
      deps
    );
    assert.equal(result.handled, false);
    assert.equal(sent.length, 0);
  });

  await test("expired pending: new message not merged", async () => {
    let now = 1000;
    const store = createConversationContextStore();
    const engine = createClarificationEngine({
      store,
      nowFn: () => now,
    });
    engine.start({
      actorKey: "telegram:1",
      chatId: 1,
      kind: "task_create",
      missingFields: ["content"],
      ttlMs: 10,
    });
    now += 50;
    const { deps, sent } = makeDeps();
    deps.engine = engine;
    const result = await handleClarificationTurn(
      {
        chatId: 1,
        text: "Позвонить Арману",
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      deps
    );
    // Expired → pending cleared; message is not merged; no technical error.
    assert.equal(result.handled, false);
    assert.equal(sent.length, 0);
    assert.equal(engine.getPending("telegram:1", 1), null);
  });

  await test("finance complete with explicit currency+description skips clarify", async () => {
    const parseFinanceFn = () => ({
      type: "expense",
      amount: 500,
      currency: "VND",
      description: "кофе",
    });
    const { deps, sent } = makeDeps({ parseFinanceFn });
    const result = await maybeStartClarificationFromFinanceAttempt(
      {
        chatId: 1,
        text: "Потратил 500 VND кофе",
        actor: { actorKey: "telegram:1" },
        parsed: parseFinanceFn(),
      },
      deps
    );
    assert.equal(result.handled, false);
    assert.equal(sent.length, 0);
  });

  console.log(
    `\nclarification-routing-regressions: ${passed} passed, ${failed} failed`
  );
}

run();
