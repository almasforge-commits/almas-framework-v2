import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPersonalKnowledgeStore,
  createIsolatedPersonalKnowledgeEngine,
} from "../services/personalKnowledge/index.js";
import {
  createReasoningStore,
  createIsolatedReasoningEngine,
} from "../services/reasoning/index.js";
import {
  runReasoningShadowObservation,
  sanitizeReasoningSummary,
  createReasoningShadowDeps,
  REASONING_SKIP,
} from "../services/reasoning/reasoningObservation.js";

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

function fact(overrides = {}) {
  return {
    id: overrides.id || `f_${Math.random().toString(36).slice(2, 8)}`,
    actorKey: "telegram:1",
    domain: "Preferences",
    content: "x",
    normalizedContent: "x",
    confidence: 0.9,
    createdAt: Date.now(),
    scope: "personal",
    status: "active",
    entities: [],
    ...overrides,
  };
}

async function run() {
  await test("disabled config produces zero reasoning calls", async () => {
    let called = 0;
    const result = await runReasoningShadowObservation(
      {
        requestKey: "rk-off",
        actor: { actorKey: "telegram:1" },
        acceptedCount: 2,
      },
      {
        forceReasoningEnabled: false,
        forcePersonalKnowledgeEnabled: true,
        reasoningConfig: { enabled: false, mode: "off" },
        personalKnowledgeConfig: { enabled: true },
        reasoningEngine: {
          deriveInsights: async () => {
            called += 1;
            return { insights: [], rejected: [] };
          },
        },
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, REASONING_SKIP.REASONING_DISABLED);
    assert.equal(result.summary, null);
    assert.equal(called, 0);
  });

  await test("no accepted Personal Knowledge facts skips reasoning", async () => {
    let called = 0;
    const result = await runReasoningShadowObservation(
      {
        requestKey: "rk-none",
        actor: { actorKey: "telegram:1" },
        acceptedCount: 0,
        personalKnowledgeSummary: {
          personalKnowledge: { accepted: 0 },
        },
      },
      createReasoningShadowDeps({
        reasoningEngine: {
          deriveInsights: async () => {
            called += 1;
            return { insights: [] };
          },
          listInsights: () => [],
          listRecommendations: () => [],
        },
        personalKnowledgeEngine: {
          store: { listByActor: () => [] },
        },
      })
    );
    assert.equal(called, 0);
    assert.equal(result.summary.reasoning.attempted, false);
    assert.ok(
      result.summary.reasoning.rejectedReasons[REASONING_SKIP.NO_PERSONAL_FACTS]
    );
  });

  await test("accepted actor-scoped facts invoke reasoning; ≥2 facts → insight", async () => {
    const pkStore = createPersonalKnowledgeStore({ maxEntries: 50 });
    const pkEngine = createIsolatedPersonalKnowledgeEngine({ store: pkStore });
    const reasoningEngine = createIsolatedReasoningEngine();

    const f1 = fact({
      id: "n1",
      content: "I like working at night",
      normalizedContent: "i like working at night",
    });
    const f2 = fact({
      id: "n2",
      content: "I am more productive after 10 PM",
      normalizedContent: "i am more productive after 10 pm",
    });
    pkStore.upsert(f1);
    pkStore.upsert(f2);

    const deps = createReasoningShadowDeps({
      personalKnowledgeEngine: pkEngine,
      reasoningEngine,
    });

    const result = await runReasoningShadowObservation(
      {
        requestKey: "rk-ok",
        actor: { actorKey: "telegram:1" },
        acceptedCount: 2,
      },
      deps
    );

    assert.equal(result.summary.reasoning.attempted, true);
    assert.equal(result.summary.reasoning.factsConsidered, 2);
    assert.ok(result.summary.reasoning.insightsDerived >= 1);
    assert.ok(
      result.summary.reasoning.insightTypes.includes("ProductivityPattern") ||
        result.summary.reasoning.insightTypes.includes("PreferencePattern")
    );
  });

  await test("recommendations only from insights; one fact never produces insight", async () => {
    const reasoningEngine = createIsolatedReasoningEngine();
    const one = await runReasoningShadowObservation(
      {
        requestKey: "rk-one",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: [
          fact({
            id: "only",
            content: "I like working at night",
            normalizedContent: "i like working at night",
          }),
        ],
        acceptedCount: 1,
      },
      createReasoningShadowDeps({ reasoningEngine })
    );
    assert.equal(one.summary.reasoning.insightsDerived, 0);

    const two = await runReasoningShadowObservation(
      {
        requestKey: "rk-two",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: [
          fact({
            id: "a",
            content: "I like working at night",
            normalizedContent: "i like working at night",
          }),
          fact({
            id: "b",
            content: "productive after 10 PM",
            normalizedContent: "productive after 10 pm",
          }),
        ],
        acceptedCount: 2,
      },
      createReasoningShadowDeps({ reasoningEngine })
    );
    assert.ok(two.summary.reasoning.insightsDerived >= 1);
    if (two.summary.reasoning.recommendationsDerived > 0) {
      const recs = await reasoningEngine.listRecommendations("telegram:1");
      assert.ok(recs.every((r) => r.insightIds.length > 0));
    }
  });

  await test("world-scoped facts excluded; actor isolation", async () => {
    const reasoningEngine = createIsolatedReasoningEngine();
    await runReasoningShadowObservation(
      {
        requestKey: "rk-w",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: [
          fact({
            id: "w1",
            scope: "world",
            content: "capital of France",
            normalizedContent: "capital of france",
          }),
          fact({
            id: "w2",
            scope: "world",
            content: "wikipedia",
            normalizedContent: "wikipedia",
          }),
        ],
        acceptedCount: 2,
      },
      createReasoningShadowDeps({ reasoningEngine })
    );
    assert.equal(
      (await reasoningEngine.listInsights("telegram:1")).length,
      0
    );

    await runReasoningShadowObservation(
      {
        requestKey: "rk-a1",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: [
          fact({
            id: "1",
            actorKey: "telegram:1",
            content: "Мне нравится кофе",
            normalizedContent: "мне нравится кофе",
          }),
          fact({
            id: "2",
            actorKey: "telegram:1",
            content: "I prefer coffee",
            normalizedContent: "i prefer coffee",
          }),
        ],
        acceptedCount: 2,
      },
      createReasoningShadowDeps({ reasoningEngine })
    );
    await runReasoningShadowObservation(
      {
        requestKey: "rk-a2",
        actor: { actorKey: "telegram:2" },
        acceptedFacts: [
          fact({
            id: "3",
            actorKey: "telegram:2",
            content: "Мне нравится чай",
            normalizedContent: "мне нравится чай",
          }),
          fact({
            id: "4",
            actorKey: "telegram:2",
            content: "I prefer tea",
            normalizedContent: "i prefer tea",
          }),
        ],
        acceptedCount: 2,
      },
      createReasoningShadowDeps({ reasoningEngine })
    );
    assert.ok(
      (await reasoningEngine.listInsights("telegram:1")).every((i) => i.actorKey === "telegram:1")
    );
    assert.ok(
      (await reasoningEngine.listInsights("telegram:2")).every((i) => i.actorKey === "telegram:2")
    );
  });

  await test("repeated requestKey does not duplicate; stable counts", async () => {
    const reasoningEngine = createIsolatedReasoningEngine();
    const facts = [
      fact({
        id: "e1",
        domain: "Finance",
        content: "Потратил 100",
        normalizedContent: "потратил 100",
      }),
      fact({
        id: "e2",
        domain: "Finance",
        content: "Купил воду",
        normalizedContent: "купил воду",
      }),
    ];
    const deps = createReasoningShadowDeps({ reasoningEngine });
    const first = await runReasoningShadowObservation(
      {
        requestKey: "rk-idem",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: facts,
        acceptedCount: 2,
      },
      deps
    );
    const second = await runReasoningShadowObservation(
      {
        requestKey: "rk-idem",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: facts,
        acceptedCount: 2,
      },
      deps
    );
    assert.equal(
      first.summary.reasoning.insightsDerived,
      second.summary.reasoning.insightsDerived
    );
    const listed = await reasoningEngine.listInsights("telegram:1");
    const finance = listed.filter((i) => i.type === "FinancialPattern");
    assert.equal(finance.length, 1);
  });

  await test("insight types deduped; failure swallowed; sanitize audit", async () => {
    const dirty = sanitizeReasoningSummary({
      reasoning: {
        attempted: true,
        factsConsidered: 3,
        insightsDerived: 2,
        recommendationsDerived: 1,
        insightTypes: ["PreferencePattern", "PreferencePattern", "FinancialPattern"],
        rejectedReasons: { low_confidence: 1 },
        shadow: true,
        description: "SHOULD_NOT",
        evidence: [{ factId: "x" }],
        content: "raw fact",
      },
    });
    assert.deepEqual(dirty.reasoning.insightTypes.sort(), [
      "FinancialPattern",
      "PreferencePattern",
    ]);
    assert.equal(dirty.reasoning.description, undefined);
    assert.equal(dirty.reasoning.evidence, undefined);
    assert.equal(dirty.reasoning.content, undefined);

    const failed = await runReasoningShadowObservation(
      {
        requestKey: "rk-fail",
        actor: { actorKey: "telegram:1" },
        acceptedFacts: [
          fact({ id: "1", content: "a", normalizedContent: "a" }),
          fact({ id: "2", content: "b", normalizedContent: "b" }),
        ],
        acceptedCount: 2,
      },
      createReasoningShadowDeps({
        reasoningEngine: {
          deriveInsights: async () => {
            throw new Error("boom");
          },
        },
      })
    );
    assert.ok(
      failed.summary.reasoning.rejectedReasons[REASONING_SKIP.REASONING_FAILED]
    );
  });

  await test("observation has no Telegram/execution/Supabase imports", () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../services/reasoning/reasoningObservation.js"
      ),
      "utf8"
    );
    for (const banned of [
      "config/bot",
      "supabase",
      "actionExecutor",
      "financeService",
      "memoryService",
      "messageHandler",
      "inboxService",
      "inboxObservation",
    ]) {
      assert.equal(src.includes(banned), false, banned);
    }
  });

  console.log(
    `\nreasoning-shadow-observation: ${passed} passed, ${failed} failed`
  );
}

run();
