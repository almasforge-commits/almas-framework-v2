import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPersonalKnowledgeStore,
  createIsolatedPersonalKnowledgeEngine,
} from "../services/personalKnowledge/index.js";
import {
  runPersonalKnowledgeShadowIngest,
  sanitizePersonalKnowledgeSummary,
  entitiesFromExtractionCandidate,
  PERSONAL_INGEST_KINDS,
  createShadowIngestDeps,
} from "../services/personalKnowledge/personalKnowledgeObservation.js";

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

function item(overrides = {}) {
  return {
    index: 0,
    kind: "goal",
    content: "Моя цель — запустить ALMAS",
    confidence: 0.9,
    entities: {},
    requiresClarification: false,
    ...overrides,
  };
}

async function run() {
  await test("accepted personal candidate", async () => {
    const store = createPersonalKnowledgeStore({ maxEntries: 50 });
    const engine = createIsolatedPersonalKnowledgeEngine({ store });
    const deps = createShadowIngestDeps({ store, engine });
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-1",
        actor: { actorKey: "telegram:1" },
        sourceType: "telegram_text",
        extraction: { items: [item()] },
      },
      deps
    );
    assert.equal(result.skipped, false);
    assert.equal(result.summary.personalKnowledge.accepted, 1);
    assert.deepEqual(result.summary.personalKnowledge.acceptedDomains, ["Goals"]);
    assert.equal(store.listByActor("telegram:1").length, 1);
    assert.equal(
      store.listByActor("telegram:1")[0].evidence.inboxRequestKey,
      "rk-1"
    );
    assert.equal(
      store.listByActor("telegram:1")[0].evidence.extractionItemIndex,
      0
    );
  });

  await test("multiple candidates preserve order", async () => {
    const store = createPersonalKnowledgeStore({ maxEntries: 50 });
    const engine = createIsolatedPersonalKnowledgeEngine({ store });
    const deps = createShadowIngestDeps({ store, engine });
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-order",
        actor: { actorKey: "telegram:1" },
        extraction: {
          items: [
            item({ index: 1, kind: "idea", content: "Идея: дневник" }),
            item({ index: 0, kind: "goal", content: "Моя цель — фокус" }),
          ],
        },
      },
      deps
    );
    assert.equal(result.summary.personalKnowledge.accepted, 2);
    assert.deepEqual(
      result.results.map((r) => r.index),
      [0, 1]
    );
  });

  await test("unsupported candidate rejected", async () => {
    const deps = createShadowIngestDeps();
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-u",
        actor: { actorKey: "telegram:1" },
        extraction: {
          items: [item({ kind: "chat", content: "привет" })],
        },
      },
      deps
    );
    assert.equal(result.summary.personalKnowledge.accepted, 0);
    assert.equal(result.summary.personalKnowledge.rejected, 1);
    assert.ok(result.summary.personalKnowledge.rejectedReasons.unsupported_kind);
  });

  await test("requiresClarification rejected", async () => {
    const deps = createShadowIngestDeps();
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-c",
        actor: { actorKey: "telegram:1" },
        extraction: {
          items: [item({ requiresClarification: true })],
        },
      },
      deps
    );
    assert.ok(
      result.summary.personalKnowledge.rejectedReasons.requires_clarification
    );
  });

  await test("low confidence rejected", async () => {
    const deps = createShadowIngestDeps();
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-low",
        actor: { actorKey: "telegram:1" },
        extraction: { items: [item({ confidence: 0.2 })] },
      },
      deps
    );
    assert.ok(result.summary.personalKnowledge.rejectedReasons.low_confidence);
  });

  await test("world/general candidate rejected", async () => {
    const deps = createShadowIngestDeps();
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-w",
        actor: { actorKey: "telegram:1" },
        extraction: {
          items: [
            item({
              kind: "knowledge",
              content: "What is the capital of France?",
              confidence: 0.95,
            }),
          ],
        },
      },
      deps
    );
    assert.ok(result.summary.personalKnowledge.rejectedReasons.world_or_general);
  });

  await test("missing actorKey rejected", async () => {
    const deps = createShadowIngestDeps();
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-a",
        actor: {},
        extraction: { items: [item()] },
      },
      deps
    );
    assert.ok(
      result.summary.personalKnowledge.rejectedReasons.missing_actor_key
    );
  });

  await test("evidence mapping + entities from bag", () => {
    const entities = entitiesFromExtractionCandidate({
      people: ["Arman"],
      companies: [{ value: "ALMAS" }],
    });
    assert.equal(entities.length, 2);
    assert.ok(PERSONAL_INGEST_KINDS.includes("finance"));
  });

  await test("idempotency by requestKey + index; no duplicates on repeat", async () => {
    const store = createPersonalKnowledgeStore({ maxEntries: 50 });
    const engine = createIsolatedPersonalKnowledgeEngine({ store });
    const deps = createShadowIngestDeps({ store, engine });
    const payload = {
      requestKey: "rk-idem",
      actor: { actorKey: "telegram:1" },
      extraction: { items: [item({ index: 2, content: "Я решил остаться" })] },
    };
    await runPersonalKnowledgeShadowIngest(payload, deps);
    await runPersonalKnowledgeShadowIngest(payload, deps);
    assert.equal(store.listByActor("telegram:1").length, 1);
  });

  await test("actor isolation", async () => {
    const store = createPersonalKnowledgeStore({ maxEntries: 50 });
    const engine = createIsolatedPersonalKnowledgeEngine({ store });
    const deps = createShadowIngestDeps({ store, engine });
    await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-a1",
        actor: { actorKey: "telegram:1" },
        extraction: { items: [item({ content: "Мне нравится кофе" })] },
      },
      deps
    );
    await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-a2",
        actor: { actorKey: "telegram:2" },
        extraction: { items: [item({ content: "Мне нравится чай" })] },
      },
      deps
    );
    assert.equal(store.listByActor("telegram:1").length, 1);
    assert.ok(!/чай/i.test(store.listByActor("telegram:1")[0].content));
  });

  await test("disabled config → zero ingest calls", async () => {
    let called = 0;
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-off",
        actor: { actorKey: "telegram:1" },
        extraction: { items: [item()] },
      },
      {
        forcePersonalKnowledgeEnabled: false,
        personalKnowledgeConfig: { enabled: false, confidenceThreshold: 0.7 },
        personalKnowledgeEngine: {
          ingest: async () => {
            called += 1;
            return { ok: true };
          },
        },
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(called, 0);
  });

  await test("ingest failure swallowed", async () => {
    const result = await runPersonalKnowledgeShadowIngest(
      {
        requestKey: "rk-fail",
        actor: { actorKey: "telegram:1" },
        extraction: { items: [item()] },
      },
      {
        forcePersonalKnowledgeEnabled: true,
        personalKnowledgeConfig: { enabled: true, confidenceThreshold: 0.7 },
        personalKnowledgeEngine: {
          ingest: async () => {
            throw new Error("boom");
          },
        },
      }
    );
    assert.equal(result.summary.personalKnowledge.rejected, 1);
    assert.ok(result.summary.personalKnowledge.rejectedReasons.ingest_failed);
  });

  await test("sanitized Inbox summary only", () => {
    const dirty = {
      personalKnowledge: {
        attempted: 2,
        accepted: 1,
        rejected: 1,
        acceptedDomains: ["Goals", "Goals"],
        rejectedReasons: { low_confidence: 1 },
        shadow: true,
        secretPrompt: "SHOULD_NOT_APPEAR",
        facts: [{ content: "raw" }],
      },
    };
    const clean = sanitizePersonalKnowledgeSummary(dirty);
    assert.equal(clean.personalKnowledge.secretPrompt, undefined);
    assert.equal(clean.personalKnowledge.facts, undefined);
    assert.deepEqual(clean.personalKnowledge.acceptedDomains, ["Goals"]);
    assert.equal(clean.personalKnowledge.shadow, true);
  });

  await test("observation module has no Telegram/execution/Supabase imports", () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../services/personalKnowledge"
    );
    const src = readFileSync(join(dir, "personalKnowledgeObservation.js"), "utf8");
    for (const banned of [
      "config/bot",
      "supabase",
      "actionExecutor",
      "financeService",
      "memoryService",
      "messageHandler",
    ]) {
      assert.equal(src.includes(banned), false, banned);
    }
  });

  console.log(
    `\npersonal-knowledge-shadow-ingest: ${passed} passed, ${failed} failed`
  );
}

run();
