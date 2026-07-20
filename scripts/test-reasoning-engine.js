import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INSIGHT_TYPES,
  createIsolatedReasoningEngine,
  createInsight,
  createEvidence,
  scoreInsightConfidence,
  MIN_EVIDENCE_FACTS,
} from "../services/reasoning/index.js";

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
  const id = overrides.id || `f_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    actorKey: "telegram:1",
    domain: "Preferences",
    content: "x",
    normalizedContent: "x",
    confidence: 0.9,
    createdAt: Date.now(),
    scope: "personal",
    entities: [],
    ...overrides,
  };
}

async function run() {
  await test("insight types closed set", () => {
    assert.ok(INSIGHT_TYPES.includes("ProductivityPattern"));
    assert.ok(INSIGHT_TYPES.includes("PreferencePattern"));
    assert.equal(MIN_EVIDENCE_FACTS, 2);
  });

  await test("contracts create insight with evidence", () => {
    const ev = createEvidence({ factId: "a", weight: 0.8, reason: "support" });
    const insight = createInsight({
      actorKey: "telegram:1",
      type: "PreferencePattern",
      title: "Stable preference pattern detected",
      description: "desc",
      confidence: 0.8,
      evidence: [ev],
    });
    assert.equal(insight.scope, undefined);
    assert.ok(insight.evidence[0].factId === "a");
    assert.ok(insight.idempotencyKey);
  });

  await test("repeated preferences produce one insight", async () => {
    const engine = createIsolatedReasoningEngine();
    const facts = [
      fact({
        id: "p1",
        content: "Мне нравится работать ночью",
        normalizedContent: "мне нравится работать ночью",
      }),
      fact({
        id: "p2",
        content: "I prefer deep work at night",
        normalizedContent: "i prefer deep work at night",
      }),
      fact({
        id: "p3",
        content: "Мне нравится тишина вечером",
        normalizedContent: "мне нравится тишина вечером",
      }),
    ];
    const result = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
      requestKey: "rk-pref",
    });
    const prefs = result.insights.filter((i) => i.type === "PreferencePattern");
    assert.ok(prefs.length >= 1);
    const again = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
      requestKey: "rk-pref",
    });
    const prefs2 = again.insights.filter((i) => i.type === "PreferencePattern");
    assert.equal(prefs[0].id, prefs2[0].id);
  });

  await test("repeated night-work facts produce productivity insight", async () => {
    const engine = createIsolatedReasoningEngine();
    const facts = [
      fact({
        id: "n1",
        content: "I like working at night",
        normalizedContent: "i like working at night",
      }),
      fact({
        id: "n2",
        domain: "Habits",
        content: "I am more productive after 10 PM",
        normalizedContent: "i am more productive after 10 pm",
      }),
      fact({
        id: "n3",
        domain: "Knowledge",
        content: "I lose focus during the day",
        normalizedContent: "i lose focus during the day",
      }),
    ];
    const result = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
    });
    const prod = result.insights.find((i) => i.type === "ProductivityPattern");
    assert.ok(prod);
    assert.ok(prod.evidence.length >= 2);
    assert.ok(prod.relatedFacts.includes("n1"));
  });

  await test("repeated expenses produce finance insight", async () => {
    const engine = createIsolatedReasoningEngine();
    const facts = [
      fact({
        id: "e1",
        domain: "Finance",
        content: "Потратил 500 на кофе",
        normalizedContent: "потратил 500 на кофе",
      }),
      fact({
        id: "e2",
        domain: "Finance",
        content: "Купил обед",
        normalizedContent: "купил обед",
      }),
    ];
    const result = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
    });
    assert.ok(result.insights.some((i) => i.type === "FinancialPattern"));
  });

  await test("duplicate facts do not duplicate insights", async () => {
    const engine = createIsolatedReasoningEngine();
    const facts = [
      fact({ id: "a", content: "Мне нравится кофе", normalizedContent: "мне нравится кофе" }),
      fact({ id: "b", content: "I like coffee", normalizedContent: "i like coffee" }),
    ];
    await engine.deriveInsights({ actorKey: "telegram:1", facts });
    await engine.deriveInsights({ actorKey: "telegram:1", facts });
    const listed = await engine.listInsights("telegram:1");
    const pref = listed.filter((i) => i.type === "PreferencePattern");
    assert.equal(pref.length, 1);
  });

  await test("contradicting facts reduce confidence", () => {
    const supporting = [
      fact({ id: "1", content: "productive after 10 pm", createdAt: Date.now() }),
      fact({ id: "2", content: "night work", createdAt: Date.now() }),
    ];
    const base = scoreInsightConfidence({ supportingFacts: supporting });
    const lower = scoreInsightConfidence({
      supportingFacts: supporting,
      contradictingFacts: [
        fact({ id: "3", content: "morning person" }),
        fact({ id: "4", content: "best in the morning" }),
      ],
    });
    assert.ok(lower.confidence < base.confidence);
  });

  await test("low confidence rejected", async () => {
    const engine = createIsolatedReasoningEngine({
      confidenceThreshold: 0.99,
    });
    const facts = [
      fact({ id: "1", content: "Мне нравится чай", confidence: 0.4 }),
      fact({ id: "2", content: "I like tea", confidence: 0.4 }),
    ];
    const result = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
    });
    assert.ok(result.rejected.length >= 1);
  });

  await test("actor isolation", async () => {
    const engine = createIsolatedReasoningEngine();
    await engine.deriveInsights({
      actorKey: "telegram:1",
      facts: [
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
    });
    await engine.deriveInsights({
      actorKey: "telegram:2",
      facts: [
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
    });
    const a = await engine.listInsights("telegram:1");
    const b = await engine.listInsights("telegram:2");
    assert.ok(a.every((i) => i.actorKey === "telegram:1"));
    assert.ok(b.every((i) => i.actorKey === "telegram:2"));
    await assert.rejects(() => engine.listInsights(""));
  });

  await test("recommendations only from insights; search works", async () => {
    const engine = createIsolatedReasoningEngine();
    const facts = [
      fact({
        id: "n1",
        content: "I like working at night",
        normalizedContent: "i like working at night",
      }),
      fact({
        id: "n2",
        content: "productive after 10 PM",
        normalizedContent: "productive after 10 pm",
      }),
    ];
    const insights = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
    });
    const recs = await engine.deriveRecommendations({
      actorKey: "telegram:1",
      insights: insights.insights,
    });
    assert.ok(recs.recommendations.length >= 1);
    assert.ok(
      recs.recommendations.every((r) => r.insightIds && r.insightIds.length > 0)
    );
    const searched = await engine.searchInsights("telegram:1", "night");
    assert.ok(searched.length >= 1);
    const recSearch = await engine.searchRecommendations("telegram:1", "22:00");
    assert.ok(recSearch.length >= 1);
  });

  await test("idempotency + evidence preserved + recalculate/clear", async () => {
    const engine = createIsolatedReasoningEngine();
    const facts = [
      fact({ id: "1", domain: "Finance", content: "Потратил 100", normalizedContent: "потратил 100" }),
      fact({ id: "2", domain: "Finance", content: "Купил воду", normalizedContent: "купил воду" }),
    ];
    const first = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
      requestKey: "same",
    });
    const second = await engine.deriveInsights({
      actorKey: "telegram:1",
      facts,
      requestKey: "same",
    });
    const fin = first.insights.find((i) => i.type === "FinancialPattern");
    const fin2 = second.insights.find((i) => i.type === "FinancialPattern");
    assert.equal(fin.id, fin2.id);
    assert.ok(fin.evidence.every((e) => e.factId && e.reason));
    engine.clear("telegram:1");
    assert.equal((await engine.listInsights("telegram:1")).length, 0);
  });

  await test("no Telegram/database/LLM import statements in reasoning modules", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../services/reasoning");
    const bannedImport = [
      /from\s+["'].*config\/bot/,
      /from\s+["'].*supabase/,
      /from\s+["'].*openai/,
      /from\s+["'].*actionExecutor/,
      /from\s+["'].*messageHandler/,
      /askAI/,
    ];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const re of bannedImport) {
        assert.equal(re.test(src), false, `${file} matched ${re}`);
      }
    }
  });

  console.log(`\nreasoning-engine: ${passed} passed, ${failed} failed`);
}

run();
