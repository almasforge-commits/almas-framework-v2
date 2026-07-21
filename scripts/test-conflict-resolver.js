/**
 * Conflict resolver regressions — false memory conflicts vs true contradictions.
 */

import assert from "node:assert/strict";
import { createEvidenceItem } from "../services/answer/answerContracts.js";
import { resolveEvidenceConflicts } from "../services/answer/conflictResolver.js";
import { collectDomainEvidence } from "../services/answer/evidenceCollector.js";
import { rankEvidence } from "../services/answer/evidenceRanker.js";
import {
  composeAnswer,
  computeConfidence,
} from "../services/answer/answerComposer.js";
import { createTelegramAnswerEngine } from "../services/answer/telegramAnswerFactory.js";
import { maybeHandleAnswerQuestion } from "../handlers/routes/answerRoute.js";
import { filterMemoriesByActor } from "../services/storage/memoryService.js";

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

function mem(id, content, extras = {}) {
  return createEvidenceItem({
    id,
    source: "memory",
    scope: "personal",
    domain: extras.domain ?? "preferences",
    confidence: extras.confidence ?? 0.75,
    content,
    provenance: {
      sourceType: "memory_service",
      provider: "memory",
      retrievedAt: Date.now(),
    },
    ...extras,
  });
}

await test("1) same-domain unrelated memories are not conflicts", () => {
  const { conflicts } = resolveEvidenceConflicts([
    mem("a", "Мне нравится работать ночью"),
    mem("b", "Мне нравится яичный кофе"),
    mem("c", "Я предпочитаю тишину"),
    mem("d", "Я работаю лучше вечером"),
  ]);
  assert.equal(conflicts.length, 0);
});

await test("2) two different preferences can coexist", () => {
  const { conflicts, evidence } = resolveEvidenceConflicts([
    mem("a", "Мне нравится работать ночью"),
    mem("b", "Мне нравится яичный кофе"),
  ]);
  assert.equal(conflicts.length, 0);
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every((e) => !e.conflict));
});

await test("3) partial token overlap alone is not a conflict", () => {
  const { conflicts } = resolveEvidenceConflicts([
    mem("a", "Я работаю лучше вечером"),
    mem("b", "Мне нравится работать ночью"),
  ]);
  assert.equal(conflicts.length, 0);
});

await test("4) direct positive/negative same-subject claims are conflicts", () => {
  const { conflicts, evidence } = resolveEvidenceConflicts([
    mem("a", "Мне нравится работать ночью"),
    mem("b", "Мне не нравится работать ночью"),
  ]);
  assert.equal(conflicts.length, 1);
  assert.ok(evidence.every((e) => e.conflict === true));
});

await test("5) Russian negation conflict works", () => {
  const { conflicts } = resolveEvidenceConflicts([
    mem("a", "Я люблю кофе"),
    mem("b", "Я не люблю кофе"),
  ]);
  assert.ok(conflicts.length >= 1);
});

await test("6) English negation conflict works", () => {
  const { conflicts } = resolveEvidenceConflicts([
    mem("a", "I like working at night", { domain: "Preferences" }),
    mem("b", "I do not like working at night", { domain: "Preferences" }),
  ]);
  assert.ok(conflicts.length >= 1);
});

await test("7) Personal-vs-World true conflict still works", () => {
  const { conflicts } = resolveEvidenceConflicts([
    createEvidenceItem({
      id: "p",
      source: "personal_knowledge",
      scope: "personal",
      domain: "Preferences",
      confidence: 0.9,
      content: "I drink coffee",
    }),
    createEvidenceItem({
      id: "w",
      source: "world_knowledge",
      scope: "world",
      domain: "Preferences",
      confidence: 0.8,
      content: "I do not drink coffee",
      provenance: {
        provider: "w",
        sourceType: "world",
        retrievedAt: Date.now(),
      },
    }),
  ]);
  assert.ok(conflicts.length >= 1);
  assert.equal(conflicts[0].type, "personal_vs_world");
  assert.equal(conflicts[0].preferredScope, "personal");
  assert.equal(conflicts[0].resolutionPolicy, "personal_priority");
});

await test("8) unrelated world and personal facts are not conflicts", () => {
  const { conflicts } = resolveEvidenceConflicts([
    createEvidenceItem({
      id: "p",
      source: "personal_knowledge",
      scope: "personal",
      domain: "Preferences",
      confidence: 0.9,
      content: "Мне нравится яичный кофе",
    }),
    createEvidenceItem({
      id: "w",
      source: "world_knowledge",
      scope: "world",
      domain: "Knowledge",
      confidence: 0.8,
      content: "WHOOP is a wearable fitness tracker",
      provenance: {
        provider: "w",
        sourceType: "world",
        retrievedAt: Date.now(),
      },
    }),
  ]);
  assert.equal(conflicts.length, 0);
});

await test("9) conflict penalty remains for real conflicts", () => {
  const evidence = [
    mem("a", "Мне нравится работать ночью", { confidence: 0.9 }),
    mem("b", "Мне не нравится работать ночью", { confidence: 0.9 }),
  ];
  const { conflicts } = resolveEvidenceConflicts(evidence);
  assert.ok(conflicts.length >= 1);
  const ranked = rankEvidence(
    evidence.map((e) => ({ ...e, conflict: true, score: 0.8 }))
  );
  const withPenalty = computeConfidence(ranked, conflicts);
  const without = computeConfidence(ranked, []);
  assert.ok(withPenalty < without);
  assert.ok(without - withPenalty >= 0.07);
});

await test("10) 10 valid memory evidences keep aggregate confidence >= 0.55", () => {
  const payload = [
    { id: "1", content: "мне нравится работать ночью", similarity: 0.5 },
    { id: "2", content: "мне нравится яичный кофе", similarity: 0.48 },
    { id: "3", content: "я предпочитаю тишину", similarity: 0.45 },
    { id: "4", content: "я работаю лучше вечером", similarity: 0.44 },
    { id: "5", content: "люблю долгие прогулки", similarity: 0.43 },
    { id: "6", content: "предпочитаю чай утром", similarity: 0.42 },
    { id: "7", content: "мне нравится читать нон-фикшн", similarity: 0.41 },
    { id: "8", content: "я люблю минимализм", similarity: 0.4 },
    { id: "9", content: "предпочитаю работу без шума", similarity: 0.39 },
    { id: "10", content: "мне нравится готовить дома", similarity: 0.38 },
  ];
  const items = collectDomainEvidence("memory", payload);
  assert.equal(items.length, 10);
  const { evidence, conflicts } = resolveEvidenceConflicts(items);
  assert.equal(conflicts.length, 0, `false conflicts: ${conflicts.length}`);
  const ranked = rankEvidence(evidence);
  const conf = computeConfidence(ranked, conflicts);
  assert.ok(conf >= 0.55, `expected conf>=0.55, got ${conf}`);
  const composed = composeAnswer({
    rankedEvidence: ranked,
    conflicts,
    minConfidence: 0.55,
    flags: { usedDomains: ["memory"] },
  });
  assert.equal(composed.needsClarification, false);
  assert.ok(composed.answer);
});

await test("11-13) recall queries answer from non-conflicting memories", async () => {
  const store = [
    {
      id: "m1",
      content: "мне нравится работать ночью",
      metadata: { userId: "42" },
      similarity: 0.5,
    },
    {
      id: "m2",
      content: "мне нравится яичный кофе",
      metadata: { userId: "42" },
      similarity: 0.48,
    },
  ];
  const engine = createTelegramAnswerEngine({
    env: {},
    searchMemoryFn: async (_q, { actorKey } = {}) =>
      filterMemoriesByActor(store, { actorKey }),
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    listInsights: async () => [],
  });

  for (const text of [
    "вспомни что мне нравится",
    "Что ты знаешь обо мне?",
    "Что ты знаешь о моих предпочтениях?",
  ]) {
    const sent = [];
    const r = await maybeHandleAnswerQuestion(
      {
        chatId: 1,
        text,
        from: { id: 42 },
        actor: { actorKey: "telegram:42" },
      },
      {
        answerEngine: engine,
        sendMessageFn: async (_c, t) => sent.push(t),
      }
    );
    assert.equal(r.handled, true);
    assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
    const body = String(r.result?.answer || "");
    assert.ok(
      !/Недостаточно надёжных данных/i.test(body),
      `unexpected clarification for: ${text} → ${body}`
    );
    assert.ok(
      /ночью|яичный|кофе/i.test(body),
      `expected memory evidence in answer for: ${text} → ${body}`
    );
  }
});

await test("exclusive favorite values still conflict", () => {
  const { conflicts } = resolveEvidenceConflicts([
    mem("a", "Мой любимый цвет зелёный"),
    mem("b", "Мой любимый цвет синий"),
  ]);
  assert.ok(conflicts.length >= 1);
});

await test("prefer coffee vs do not drink coffee may conflict", () => {
  const { conflicts } = resolveEvidenceConflicts([
    mem("a", "Я предпочитаю кофе"),
    mem("b", "Я не пью кофе"),
  ]);
  assert.ok(conflicts.length >= 1);
});

console.log(`\nconflict-resolver: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
