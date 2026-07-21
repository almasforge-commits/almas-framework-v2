/**
 * Memory recall quality regressions: dedupe, prefix strip, intent filtering.
 */

import assert from "node:assert/strict";
import {
  extractLegacyMemorySaveContent,
  normalizeMemoryFactContent,
} from "../services/storage/memoryFilter.js";
import { dedupeEvidence } from "../services/answer/evidenceDedupe.js";
import { createEvidenceItem } from "../services/answer/answerContracts.js";
import { planAnswerRetrieval } from "../services/answer/answerPlanner.js";
import { filterMemoriesForIntent } from "../services/answer/memoryIntentFilter.js";
import { collectDomainEvidence } from "../services/answer/evidenceCollector.js";
import { composeAnswer } from "../services/answer/answerComposer.js";
import { rankEvidence } from "../services/answer/evidenceRanker.js";
import { resolveEvidenceConflicts } from "../services/answer/conflictResolver.js";
import { createTelegramAnswerEngine } from "../services/answer/telegramAnswerFactory.js";
import { maybeHandleAnswerQuestion } from "../handlers/routes/answerRoute.js";

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

await test("1) duplicate memories collapse into one answer", () => {
  const items = [
    createEvidenceItem({
      id: "memory:1",
      factId: "1",
      source: "memory",
      scope: "personal",
      confidence: 0.75,
      content: "мне нравится работать ночью",
      provenance: { provider: "memory", sourceType: "memory_service", retrievedAt: 1 },
    }),
    createEvidenceItem({
      id: "memory:2",
      factId: "2",
      source: "memory",
      scope: "personal",
      confidence: 0.8,
      content: "Запомни, что мне нравится работать ночью",
      provenance: { provider: "memory", sourceType: "memory_service", retrievedAt: 2 },
    }),
    createEvidenceItem({
      id: "memory:3",
      factId: "3",
      source: "memory",
      scope: "personal",
      confidence: 0.7,
      content: "Мне нравится работать ночью",
      provenance: { provider: "memory", sourceType: "memory_service", retrievedAt: 3 },
    }),
  ];
  const deduped = dedupeEvidence(items);
  assert.equal(deduped.length, 1);
  assert.match(deduped[0].content, /нравится работать ночью/i);
  assert.ok(!/^запомни/i.test(deduped[0].content));

  const { evidence } = resolveEvidenceConflicts(deduped);
  const ranked = rankEvidence(evidence);
  const composed = composeAnswer({
    rankedEvidence: ranked,
    conflicts: [],
    minConfidence: 0.55,
    flags: { usedDomains: ["memory"] },
  });
  assert.equal(composed.needsClarification, false);
  const lines = String(composed.answer || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.equal(lines.length, 1);
});

await test("2+3) Запомни prefix stripped; same fact stored once shape", () => {
  const a = extractLegacyMemorySaveContent(
    "Запомни, что мне нравится работать ночью"
  );
  assert.equal(a.kind, "save");
  assert.equal(a.content, "Мне нравится работать ночью");
  assert.equal(
    normalizeMemoryFactContent("Запомни что мне нравится работать ночью"),
    "Мне нравится работать ночью"
  );
  assert.equal(
    normalizeMemoryFactContent("Запомни, что мне нравится работать ночью"),
    "Мне нравится работать ночью"
  );
});

await test("4) Remember that prefix stripped", () => {
  assert.equal(
    normalizeMemoryFactContent("Remember that I like coffee"),
    "I like coffee"
  );
  assert.equal(
    extractLegacyMemorySaveContent("Remember that I like coffee").content,
    "I like coffee"
  );
});

await test("5) preference query excludes tasks", () => {
  const plan = planAnswerRetrieval({
    actorKey: "telegram:1",
    query: "Что ты знаешь о моих предпочтениях?",
  });
  assert.equal(plan.intent, "preferences_query");
  assert.deepEqual(plan.domains, ["memory"]);
  assert.ok(!plan.domains.includes("tasks"));

  const filtered = filterMemoriesForIntent(
    [
      {
        id: "1",
        content: "Мне нравится работать ночью",
        metadata: { memoryType: "note" },
      },
      {
        id: "2",
        content: "Купить молоко",
        metadata: { memoryType: "task" },
      },
    ],
    plan.intent
  );
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].content, /ночью/i);
});

await test("6) preference query excludes finance-like memories", () => {
  const filtered = filterMemoriesForIntent(
    [
      { id: "1", content: "Мне нравится яичный кофе", metadata: {} },
      { id: "2", content: "Купил кофе", metadata: {} },
      { id: "3", content: "Потратил 40000 на обед", metadata: {} },
    ],
    "preferences_query"
  );
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].content, /яичный/i);
});

await test("7) about-me query returns preferences (not tasks)", async () => {
  const store = [
    {
      id: "m1",
      content: "Мне нравится работать ночью",
      metadata: { userId: "42", memoryType: "note" },
      similarity: 0.7,
    },
    {
      id: "m2",
      content: "Купить молоко",
      metadata: { userId: "42", memoryType: "task" },
      similarity: 0.9,
    },
  ];
  const engine = createTelegramAnswerEngine({
    env: {},
    searchMemoryFn: async () => store,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => ({ VND: { balance: 1 } }),
    getTasksSnapshot: async () => [{ id: "t1", content: "Купить молоко" }],
    searchKnowledgeFn: async () => [{ id: "k1", title: "WHOOP" }],
  });
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "Что ты знаешь обо мне?",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  const body = String(r.result?.answer || "");
  assert.match(body, /ночью/i);
  assert.ok(!/Купить молоко/i.test(body));
  assert.ok(!/WHOOP/i.test(body));
  assert.ok(!/Balance|VND|баланс/i.test(body));
});

await test("8) task query returns only tasks", () => {
  const plan = planAnswerRetrieval({
    actorKey: "telegram:1",
    query: "какие у меня задачи",
  });
  assert.equal(plan.intent, "task_query");
  assert.deepEqual(plan.domains, ["tasks"]);
  assert.ok(!plan.domains.includes("finance"));
  assert.ok(!plan.domains.includes("memory"));
});

await test("9) finance query returns only finance", () => {
  const plan = planAnswerRetrieval({
    actorKey: "telegram:1",
    query: "какой у меня баланс",
  });
  assert.equal(plan.intent, "finance_query");
  assert.deepEqual(plan.domains, ["finance"]);
  assert.ok(!plan.domains.includes("tasks"));
  assert.ok(!plan.domains.includes("memory"));
});

await test("10) duplicate evidence keeps provenance", () => {
  const items = [
    createEvidenceItem({
      id: "memory:1",
      source: "memory",
      scope: "personal",
      confidence: 0.9,
      content: "Мне нравится работать ночью",
      provenance: { provider: "memory", sourceType: "memory_service", retrievedAt: 1 },
    }),
    createEvidenceItem({
      id: "memory:2",
      source: "memory",
      scope: "personal",
      confidence: 0.75,
      content: "Запомни, что мне нравится работать ночью",
      provenance: { provider: "memory", sourceType: "memory_service", retrievedAt: 2 },
    }),
  ];
  const deduped = dedupeEvidence(items);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].confidence, 0.9);
  assert.ok(Array.isArray(deduped[0].provenance?.duplicates));
  assert.equal(deduped[0].provenance.duplicates.length, 1);
  assert.equal(deduped[0].provenance.duplicates[0].id, "memory:2");
  assert.equal(deduped[0].provenance.provider, "memory");
});

await test("mapped memory strips legacy command wrappers", () => {
  const mapped = collectDomainEvidence("memory", [
    {
      id: "x",
      content: "Запомни, что мне нравится яичный кофе",
      similarity: 0.6,
    },
  ]);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].content, "Мне нравится яичный кофе");
});

await test("preference recall via answer path has no duplicates", async () => {
  const store = [
    {
      id: "a",
      content: "мне нравится работать ночью",
      metadata: { userId: "7" },
      similarity: 0.6,
    },
    {
      id: "b",
      content: "Запомни, что мне нравится работать ночью",
      metadata: { userId: "7" },
      similarity: 0.55,
    },
    {
      id: "c",
      content: "Мне нравится работать ночью",
      metadata: { userId: "7" },
      similarity: 0.5,
    },
  ];
  const engine = createTelegramAnswerEngine({
    env: {},
    searchMemoryFn: async () => store,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
  });
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "вспомни что мне нравится",
      from: { id: 7 },
      actor: { actorKey: "telegram:7" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  const body = String(r.result?.answer || "");
  assert.ok(!/Недостаточно надёжных данных/i.test(body));
  const matches = body.match(/нравится работать ночью/gi) || [];
  assert.equal(matches.length, 1, `expected one fact line, got: ${body}`);
  assert.ok(!/Запомни/i.test(body));
});

await test("isUserFact accepts personal facts and rejects system labels", async () => {
  const { isUserFact, isNavigationOrSystemMemory } = await import(
    "../services/answer/memoryQuality.js"
  );
  assert.equal(isUserFact("Мне нравится работать ночью."), true);
  assert.equal(isUserFact("Люблю вьетнамский кофе."), true);
  assert.equal(isUserFact("Меня зовут Алмас"), true);
  assert.equal(isUserFact("Я живу в Дананге"), true);
  assert.equal(isUserFact("Работаю лучше вечером"), true);

  for (const bad of [
    "Мои задачи",
    "Мои доходы",
    "Мои расходы",
    "Баланс",
    "История",
    "Меню",
    "YouTube",
    "Открыть знания",
    "помощь",
    "start",
  ]) {
    assert.equal(isNavigationOrSystemMemory(bad), true, bad);
    assert.equal(isUserFact(bad), false, bad);
  }
});

await test("about-me never returns navigation/system memories", async () => {
  const store = [
    {
      id: "1",
      content: "Мне нравится работать ночью.",
      metadata: { userId: "42" },
      similarity: 0.9,
    },
    {
      id: "2",
      content: "Мне нравится яичный кофе вьетнамский.",
      metadata: { userId: "42" },
      similarity: 0.88,
    },
    {
      id: "3",
      content: "Мои задачи",
      metadata: { userId: "42" },
      similarity: 0.95,
    },
    {
      id: "4",
      content: "Мои доходы",
      metadata: { userId: "42" },
      similarity: 0.94,
    },
    {
      id: "5",
      content: "Мои расходы",
      metadata: { userId: "42" },
      similarity: 0.93,
    },
    {
      id: "6",
      content: "Баланс",
      metadata: { userId: "42" },
      similarity: 0.92,
    },
  ];
  const engine = createTelegramAnswerEngine({
    env: {},
    searchMemoryFn: async () => store,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
  });
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "What do you know about me?",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  const body = String(r.result?.answer || "");
  assert.match(body, /ночью/i);
  assert.match(body, /кофе/i);
  assert.ok(!/Мои задачи/i.test(body));
  assert.ok(!/Мои доходы/i.test(body));
  assert.ok(!/Мои расходы/i.test(body));
  assert.ok(!/\bБаланс\b/i.test(body));
});

console.log(`\nmemory-recall-quality: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
