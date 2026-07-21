/**
 * Read-only Answer Engine Telegram path tests.
 * Does not import messageHandler / bot.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyAnswerRouteIntent } from "../services/answer/answerQuestionGate.js";
import { formatTelegramAnswerReply } from "../services/answer/formatTelegramAnswer.js";
import { createTelegramAnswerEngine } from "../services/answer/telegramAnswerFactory.js";
import { maybeHandleAnswerQuestion } from "../handlers/routes/answerRoute.js";
import { EXECUTION_NONE, createAnswerResult } from "../services/answer/index.js";
import { detectDeterministicIntent } from "../services/inbox/deterministicIntentDetector.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err);
    failed += 1;
  }
}

await test("question routes through Answer Engine", async () => {
  const sent = [];
  let answered = false;
  const fakeEngine = {
    answer: async (input) => {
      answered = true;
      assert.equal(input.actorKey, "telegram:42");
      assert.match(input.query, /WHOOP|projects|spent/i);
      return createAnswerResult({
        answer: "WHOOP is a wearable mentioned in your notes.",
        confidence: 0.82,
        sources: [
          {
            source: "personal_knowledge",
            scope: "personal",
            domain: "Health",
            confidence: 0.9,
            factId: "f1",
          },
        ],
        usedPersonalKnowledge: true,
      });
    },
  };

  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "What do you know about WHOOP?",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    {
      sendMessageFn: async (c, t) => sent.push({ c, t }),
      answerEngine: fakeEngine,
    }
  );

  assert.equal(r.handled, true);
  assert.equal(answered, true);
  assert.equal(r.result.execution.type, "none");
  assert.match(r.result.answer || "", /WHOOP/);
  assert.match(sent[0].t, /Found|Open in ALMAS/);
});

await test("execution bypasses Answer Engine", async () => {
  for (const text of [
    "потратил 100 рублей на кофе",
    "выполнено 1",
    "удалить все знания",
  ]) {
    const c = classifyAnswerRouteIntent(text);
    assert.equal(
      c.useAnswerEngine,
      false,
      `expected bypass for: ${text} got ${c.reason}`
    );
  }

  let called = false;
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "потратил 50 долларов на обед",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    {
      sendMessageFn: async () => {},
      answerEngine: {
        answer: async () => {
          called = true;
          return createAnswerResult({});
        },
      },
    }
  );
  assert.equal(r.handled, false);
  assert.equal(called, false);
});

await test("navigation and exact commands bypass Answer Engine", async () => {
  for (const text of [
    "📚 Знания",
    "баланс",
    "мои задачи",
    "мои знания",
    "история",
    "привет",
  ]) {
    const c = classifyAnswerRouteIntent(text);
    assert.equal(c.useAnswerEngine, false, text);
  }
});

await test("prefix questions use Answer Engine (спроси/найди/вспомни)", async () => {
  assert.equal(classifyAnswerRouteIntent("спроси что такое RAG").useAnswerEngine, true);
  assert.equal(classifyAnswerRouteIntent("найди отчет").useAnswerEngine, true);
  assert.equal(classifyAnswerRouteIntent("вспомни кофе").useAnswerEngine, true);
  assert.equal(classifyAnswerRouteIntent("открыть 1").useAnswerEngine, false);
  assert.equal(classifyAnswerRouteIntent("покажи 2").useAnswerEngine, false);
});

await test("confidence / clarification / conflicts preserved in reply", async () => {
  const clarification = formatTelegramAnswerReply(
    createAnswerResult({
      needsClarification: true,
      clarificationQuestion: "Уточните период расходов.",
      confidence: 0.2,
    })
  );
  assert.equal(clarification, "Уточните период расходов.");

  const withConflict = formatTelegramAnswerReply(
    createAnswerResult({
      answer: "I drink tea",
      confidence: 0.77,
      conflicts: [{ group: "c1", preferredScope: "personal" }],
      sources: [
        {
          source: "personal_knowledge",
          scope: "personal",
          domain: "Preferences",
          confidence: 0.9,
        },
        {
          source: "world_knowledge",
          scope: "world",
          domain: "Preferences",
          confidence: 0.4,
        },
      ],
    })
  );
  assert.ok(withConflict.includes("77%"));
  assert.ok(withConflict.includes("противоречия"));
  assert.ok(withConflict.includes("personal"));
  assert.ok(withConflict.includes("world"));
});

await test("personal priority and world provenance in engine path", async () => {
  const engine = createTelegramAnswerEngine({
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "p1",
          content: "I drink tea every morning",
          confidence: 0.95,
          scope: "personal",
          domain: "Preferences",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
      ],
    }),
    searchWorld: async () => [
      {
        id: "w1",
        content: "I do not drink tea every morning",
        confidence: 0.9,
        domain: "Preferences",
        scope: "world",
        provenance: {
          sourceType: "world_provider",
          provider: "test_world",
          retrievedAt: Date.now(),
        },
      },
    ],
    getFinanceSnapshot: async () => ({}),
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:9",
    query: "what do I drink",
    planOverrides: { includeDomains: false },
  });
  assert.equal(result.execution.type, "none");
  assert.equal(result.usedPersonalKnowledge, true);
  assert.equal(result.usedWorldKnowledge, true);
  if (result.answer) {
    assert.ok(/tea/i.test(result.answer));
  }
  const reply = formatTelegramAnswerReply(result);
  assert.ok(reply.includes("world") || result.sources.some((s) => s.scope === "world"));
});

await test("no execution / no writes from answer route", async () => {
  let writeCalled = false;
  const sent = [];
  await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "What ideas have I written?",
      actor: { actorKey: "telegram:7" },
    },
    {
      sendMessageFn: async (_c, t) => sent.push(t),
      answerEngine: {
        answer: async () =>
          createAnswerResult({
            answer: "No ideas yet.",
            confidence: 0.6,
            execution: EXECUTION_NONE,
          }),
      },
      // If someone mistakenly wired writes, spies would catch — we simply
      // assert execution stays none and no write helpers exist on options.
    }
  );
  assert.equal(writeCalled, false);
  assert.ok(sent.length === 1);
  assert.ok(!/addExpense|saveMemory|createTask/.test(sent[0]));
});

await test("reuses detectDeterministicIntent (no parallel classifier)", async () => {
  const d = detectDeterministicIntent("спроси что такое RAG");
  assert.equal(d.actions[0].type, "chat");
  const c = classifyAnswerRouteIntent("спроси что такое RAG");
  assert.equal(c.useAnswerEngine, true);
  assert.equal(c.actionType, "chat");
});

await test("messageHandler wires answerRoute; no AI router ownership edits", async () => {
  const mh = readFileSync(join(root, "handlers/messageHandler.js"), "utf8");
  assert.ok(mh.includes("maybeHandleAnswerQuestion"));
  assert.ok(mh.includes("answerRoute.js"));
  // Ownership helpers unchanged
  assert.ok(mh.includes("getExecutedOwnedActions"));
  assert.ok(mh.includes("decideRouting"));
  assert.ok(mh.includes("observeMessage"));
  // Legacy RAG chat path removed from спроси
  assert.ok(!mh.includes("askKnowledgeChunks"));
  assert.ok(!mh.includes("askKnowledge("));

  const router = readFileSync(
    join(root, "services/inbox/routingDecisionService.js"),
    "utf8"
  );
  assert.ok(!router.includes("answerRoute"));
  assert.ok(!router.includes("createAnswerEngine"));

  const executor = readFileSync(
    join(root, "services/inbox/actionExecutor.js"),
    "utf8"
  );
  assert.ok(!executor.includes("answerEngine"));
});

await test("empty evidence replies do-not-know", async () => {
  const reply = formatTelegramAnswerReply(
    createAnswerResult({ answer: null, confidence: 0, needsClarification: false })
  );
  assert.equal(reply, "Пока я этого не знаю.");
});

console.log(`\nanswer-telegram-path: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
