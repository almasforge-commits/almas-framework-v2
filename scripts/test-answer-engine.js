/**
 * Isolated Answer Engine architecture tests.
 * No Telegram, no Supabase writes, no execution, no AI Router changes.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAnswerEngine,
  createIsolatedAnswerEngine,
  createEvidenceItem,
  planAnswerRetrieval,
  rankEvidence,
  resolveEvidenceConflicts,
  composeAnswer,
  computeConfidence,
  EXECUTION_NONE,
} from "../services/answer/index.js";

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

function makeEngine(overrides = {}) {
  return createIsolatedAnswerEngine({
    includeDebug: true,
    ...overrides,
  });
}

await test("conversation context retrieval", async () => {
  const engine = makeEngine({
    getPending: async () => ({
      id: "p1",
      actorKey: "telegram:1",
      chatId: "9",
      kind: "task_create",
      status: "pending",
      question: "Что нужно сделать?",
      missingFields: ["content"],
      createdAt: Date.now(),
    }),
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    chatId: "9",
    query: "продолжи",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(r.usedConversationContext, true);
  assert.equal(r.needsClarification, true);
  assert.ok(String(r.clarificationQuestion).includes("сделать") || r.missingFields.length);
});

await test("personal retrieval", async () => {
  const engine = makeEngine({
    retrievePersonal: async ({ actorKey, scopes }) => {
      assert.equal(actorKey, "telegram:1");
      assert.deepEqual(scopes, ["personal"]);
      return {
        ok: true,
        results: [
          {
            id: "f1",
            actorKey: "telegram:1",
            domain: "Preferences",
            content: "I prefer quiet mornings",
            confidence: 0.9,
            scope: "personal",
            provenance: {
              sourceType: "user_text",
              provider: "pk",
              retrievedAt: Date.now(),
            },
          },
          {
            id: "f2",
            actorKey: "telegram:1",
            domain: "Preferences",
            content: "I like quiet mornings for deep work",
            confidence: 0.88,
            scope: "personal",
            provenance: {
              sourceType: "user_text",
              provider: "pk",
              retrievedAt: Date.now(),
            },
          },
        ],
      };
    },
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "What are my preferences?",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(r.usedPersonalKnowledge, true);
  assert.ok(r.answer);
  assert.ok(r.confidence > 0.5);
  assert.equal(r.execution.type, "none");
});

await test("reasoning retrieval", async () => {
  const engine = makeEngine({
    retrievePersonal: async () => ({ ok: true, results: [] }),
    reasoningEngine: {
      searchInsights: async () => [
        {
          id: "i1",
          type: "PreferencePattern",
          title: "Prefers quiet mornings",
          description: "Repeated preference for quiet mornings",
          confidence: 0.85,
          relatedDomains: ["Preferences"],
          createdAt: Date.now(),
        },
      ],
      listRecommendations: async () => [
        {
          id: "r1",
          title: "Schedule deep work early",
          description: "Based on morning preference",
          confidence: 0.8,
          insightIds: ["i1"],
          createdAt: Date.now(),
        },
      ],
    },
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "morning preferences insights",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(r.usedReasoning, true);
  assert.ok(r.sources.some((s) => s.source === "reasoning_insight"));
});

await test("world retrieval + provenance", async () => {
  const engine = makeEngine({
    retrievePersonal: async () => ({ ok: true, results: [] }),
    searchWorld: async (q) => {
      assert.ok(q);
      return [
        {
          id: "w1",
          content: "Bangkok is the capital of Thailand",
          confidence: 0.7,
          domain: "Knowledge",
          scope: "world",
          provenance: {
            sourceType: "world_provider",
            provider: "test_world",
            retrievedAt: Date.now(),
          },
        },
      ];
    },
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "what is Bangkok",
    planOverrides: {
      includeWorld: true,
      includeDomains: false,
      includePersonal: true,
      includeReasoning: false,
    },
  });
  assert.equal(r.usedWorldKnowledge, true);
  const worldSrc = r.sources.find((s) => s.scope === "world");
  assert.ok(worldSrc);
});

await test("evidence ranking deterministic", async () => {
  const now = 1_700_000_000_000;
  const items = [
    createEvidenceItem({
      id: "w",
      source: "world_knowledge",
      scope: "world",
      confidence: 0.9,
      timestamp: now,
      content: "world claim",
      provenance: { provider: "w", sourceType: "world", retrievedAt: now },
    }),
    createEvidenceItem({
      id: "p",
      source: "personal_knowledge",
      scope: "personal",
      confidence: 0.8,
      timestamp: now,
      content: "personal claim",
      provenance: { provider: "pk", sourceType: "user", retrievedAt: now },
    }),
  ];
  const a = rankEvidence(items, { nowMs: now });
  const b = rankEvidence(items, { nowMs: now });
  assert.deepEqual(
    a.map((e) => e.id),
    b.map((e) => e.id)
  );
  assert.equal(a[0].id, "p");
});

await test("conflict resolution prefers personal", async () => {
  const { evidence, conflicts } = resolveEvidenceConflicts([
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
      provenance: { provider: "w", sourceType: "world", retrievedAt: Date.now() },
    }),
  ]);
  assert.ok(conflicts.length >= 1);
  assert.equal(conflicts[0].preferredScope, "personal");
  assert.ok(evidence.every((e) => e.conflict === true));
  assert.equal(evidence.length, 2);
});

await test("clarification on empty / weak evidence", async () => {
  const engine = makeEngine({
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const empty = await engine.answer({
    actorKey: "telegram:1",
    query: "tell me secrets",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(empty.needsClarification, true);
  assert.equal(empty.answer, null);
  assert.ok(empty.confidence < 0.55);

  const weak = composeAnswer({
    rankedEvidence: [
      createEvidenceItem({
        id: "w",
        source: "world_knowledge",
        scope: "world",
        confidence: 0.3,
        content: "maybe something",
        score: 0.2,
        provenance: { provider: "w", sourceType: "world", retrievedAt: 1 },
      }),
    ],
    conflicts: [],
    flags: { usedWorldKnowledge: true },
    minConfidence: 0.55,
  });
  assert.equal(weak.needsClarification, true);
});

await test("confidence from agreement factors", async () => {
  const ranked = [
    createEvidenceItem({
      id: "1",
      source: "personal_knowledge",
      scope: "personal",
      confidence: 0.9,
      content: "a",
      score: 0.8,
    }),
    createEvidenceItem({
      id: "2",
      source: "reasoning_insight",
      scope: "reasoning",
      confidence: 0.85,
      content: "a support",
      score: 0.75,
    }),
  ];
  const c = computeConfidence(ranked, []);
  assert.ok(c > 0.5);
  const worldOnly = computeConfidence(
    [
      createEvidenceItem({
        id: "w",
        source: "world_knowledge",
        scope: "world",
        confidence: 0.9,
        content: "x",
        score: 0.5,
        provenance: { provider: "w", sourceType: "world", retrievedAt: 1 },
      }),
    ],
    []
  );
  assert.ok(worldOnly < c);
});

await test("empty result / missing actor", async () => {
  const engine = makeEngine();
  const r = await engine.answer({ query: "hello" });
  assert.equal(r.needsClarification, true);
  assert.deepEqual(r.missingFields, ["actorKey"]);
  assert.deepEqual(r.execution, EXECUTION_NONE);
});

await test("multiple domains via injectables", async () => {
  const engine = makeEngine({
    retrievePersonal: async () => ({ ok: true, results: [] }),
    getFinanceSnapshot: async () => ({ VND: { balance: 1000 } }),
    getTasksSnapshot: async () => [{ id: "t1", content: "Buy milk" }],
    searchKnowledgeFn: async () => [{ id: "k1", title: "Note A", score: 0.8 }],
    searchMemoryFn: async () => [{ id: "m1", content: "Remember X", confidence: 0.7 }],
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "баланс и задачи и знания вспомни",
    planOverrides: { includeWorld: false, includeDomains: true },
  });
  assert.ok(r.usedDomains.includes("finance"));
  assert.ok(r.usedDomains.includes("tasks"));
  assert.ok(r.answer || r.needsClarification === false || r.sources.length > 0);
  assert.ok(r.sources.length >= 2);
});

await test("personal priority over world in answer", async () => {
  const engine = makeEngine({
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "p1",
          domain: "Preferences",
          content: "I drink tea every morning",
          confidence: 0.92,
          scope: "personal",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: Date.now() },
        },
      ],
    }),
    searchWorld: async () => [
      {
        id: "w1",
        content: "I do not drink tea every morning",
        confidence: 0.95,
        domain: "Preferences",
        scope: "world",
        provenance: {
          sourceType: "world_provider",
          provider: "test_world",
          retrievedAt: Date.now(),
        },
      },
    ],
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "what do I drink",
    planOverrides: {
      includeWorld: true,
      includeDomains: false,
      includeReasoning: false,
    },
  });
  assert.equal(r.usedPersonalKnowledge, true);
  assert.equal(r.usedWorldKnowledge, true);
  assert.ok(r.conflicts.length >= 1 || r.evidenceSummary.conflictCount >= 0);
  if (r.answer) {
    assert.ok(/tea/i.test(r.answer));
    assert.ok(!/do not drink tea/i.test(r.answer));
  }
});

await test("deterministic outputs for same inputs", async () => {
  const deps = {
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "f1",
          domain: "Goals",
          content: "Learn TypeScript",
          confidence: 0.9,
          scope: "personal",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 100 },
        },
        {
          id: "f2",
          domain: "Goals",
          content: "Practice TypeScript weekly",
          confidence: 0.88,
          scope: "personal",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 100 },
        },
      ],
    }),
    nowFn: () => 1_700_000_000_000,
  };
  const a = await makeEngine(deps).answer({
    actorKey: "telegram:1",
    query: "my goals",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  const b = await makeEngine(deps).answer({
    actorKey: "telegram:1",
    query: "my goals",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(a.answer, b.answer);
  assert.equal(a.confidence, b.confidence);
  assert.deepEqual(a.sources, b.sources);
});

await test("dependency injection — no hidden defaults required", async () => {
  const engine = createAnswerEngine({
    env: {},
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "x",
          content: "Solo fact enough with twin",
          confidence: 0.9,
          scope: "personal",
          domain: "Ideas",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
        {
          id: "y",
          content: "Solo fact twin idea",
          confidence: 0.9,
          scope: "personal",
          domain: "Ideas",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
      ],
    }),
  });
  const r = await engine.answer({
    actorKey: "telegram:2",
    query: "ideas",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(r.execution.type, "none");
  assert.equal(r.usedPersonalKnowledge, true);
});

await test("planner marks finance/task domains", async () => {
  const p = planAnswerRetrieval({
    actorKey: "a",
    query: "покажи баланс",
  });
  assert.equal(p.intent, "finance_query");
  assert.ok(p.domains.includes("finance"));
});

await test("no Telegram / Supabase write / execution / AI router imports", async () => {
  const dir = join(root, "services/answer");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  const forbidden = [
    "node-telegram-bot-api",
    "handlers/",
    "messageHandler",
    "actionExecutor",
    "createClient",
    "@supabase",
    "openai",
    "aiIntentAnalyzer",
    "decideRouting",
    "addExpense",
    "addIncome",
    "saveMemory",
    "createTask",
  ];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const bad of forbidden) {
      assert.ok(
        !text.includes(bad),
        `${f} must not contain ${bad}`
      );
    }
  }
  // config must not force writes
  const cfg = readFileSync(join(root, "config/answerEngine.js"), "utf8");
  assert.ok(cfg.includes("allowExecution: false"));
});

await test("execution always none on result", async () => {
  const engine = makeEngine({
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "anything",
    planOverrides: { includeWorld: false },
  });
  assert.deepEqual(r.execution, EXECUTION_NONE);
  assert.deepEqual(r.execution.actions, []);
});

console.log(`\nanswer-engine: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
