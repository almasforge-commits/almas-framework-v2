import assert from "node:assert/strict";

import {
  createIsolatedPersonalKnowledgeEngine,
  createPersonalKnowledgeStore,
  createWorldKnowledgeAdapter,
  dedupeRetrievalHits,
  PERSONAL_SCOPE,
  WORLD_SCOPE,
} from "../services/personalKnowledge/index.js";

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
  await test("actor isolation", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine();
    await engine.ingest({
      actorKey: "telegram:1",
      text: "Мне нравится кофе",
      sourceType: "user_text",
    });
    await engine.ingest({
      actorKey: "telegram:2",
      text: "Мне нравится чай",
      sourceType: "user_text",
    });
    const a = await engine.retrieve({
      actorKey: "telegram:1",
      query: "нравится",
      scopes: [PERSONAL_SCOPE],
    });
    assert.ok(a.results.every((r) => r.actorKey === "telegram:1"));
    assert.ok(a.results.every((r) => !/чай/i.test(r.content)));
    assert.throws(() => engine.store.listByActor(""));
  });

  await test("idempotent ingest with requestKey", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine();
    const first = await engine.ingest({
      actorKey: "telegram:1",
      text: "Меня зовут Алмас",
      requestKey: "same",
      sourceType: "user_text",
    });
    const second = await engine.ingest({
      actorKey: "telegram:1",
      text: "Меня зовут Алмас",
      requestKey: "same",
      sourceType: "user_text",
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.reason, "upserted");
    assert.equal(first.fact.id, second.fact.id);
    assert.equal(engine.store.listByActor("telegram:1").length, 1);
  });

  await test("stable hash fallback idempotency", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine();
    const first = await engine.ingest({
      actorKey: "telegram:1",
      text: "Моя цель — свобода",
      sourceType: "user_text",
    });
    const second = await engine.ingest({
      actorKey: "telegram:1",
      text: "Моя цель — свобода",
      sourceType: "user_text",
    });
    assert.equal(first.fact.id, second.fact.id);
    assert.equal(second.reason, "upserted");
  });

  await test("world/general rejected; personal stored", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine();
    const world = await engine.ingest({
      actorKey: "telegram:1",
      text: "What is the capital of France?",
      sourceType: "user_text",
    });
    assert.equal(world.ok, false);
    assert.equal(world.reason, "world_or_general");

    const personal = await engine.ingest({
      actorKey: "telegram:1",
      text: "I prefer working at night",
      sourceType: "user_text",
    });
    assert.equal(personal.ok, true);
    assert.equal(personal.fact.domain, "Preferences");
    assert.equal(personal.fact.scope, PERSONAL_SCOPE);
  });

  await test("Timeline write rejected", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine({
      classifyFn: () => ({
        domain: "Timeline",
        confidence: 0.99,
        scope: "personal",
      }),
    });
    const r = await engine.ingest({
      actorKey: "telegram:1",
      text: "встреча в пятницу",
      sourceType: "user_text",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeline_write_forbidden");
  });

  await test("personal retrieval", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine();
    await engine.ingest({
      actorKey: "telegram:1",
      text: "Я решил остаться в Бангкоке",
      sourceType: "user_text",
    });
    const r = await engine.retrieve({
      actorKey: "telegram:1",
      query: "бангкок",
      scopes: [PERSONAL_SCOPE],
    });
    assert.equal(r.ok, true);
    assert.ok(r.results.length >= 1);
    assert.equal(r.results[0].scope, PERSONAL_SCOPE);
    assert.ok(r.results[0].provenance);
    assert.equal(r.results[0].provenance.provider, "personal_store");
  });

  await test("world retrieval provenance; never written personal", async () => {
    const engine = createIsolatedPersonalKnowledgeEngine({
      searchWorldFn: async () => [
        {
          id: "w1",
          content: "Bangkok is the capital of Thailand",
          provider: "test_world",
          sourceType: "encyclopedia",
          confidence: 0.8,
        },
      ],
    });
    const r = await engine.retrieve({
      actorKey: "telegram:1",
      query: "Bangkok",
      scopes: [WORLD_SCOPE],
    });
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].scope, WORLD_SCOPE);
    assert.equal(r.results[0].provenance.provider, "test_world");
    assert.equal(engine.store.listByActor("telegram:1").length, 0);
  });

  await test("merged retrieval deduplication prefers personal", () => {
    const hits = dedupeRetrievalHits([
      {
        scope: WORLD_SCOPE,
        content: "I like coffee",
        confidence: 0.9,
        provenance: {},
      },
      {
        scope: PERSONAL_SCOPE,
        content: "I like coffee",
        confidence: 0.8,
        provenance: {},
      },
      {
        scope: PERSONAL_SCOPE,
        content: "I like coffee",
        confidence: 0.95,
        provenance: {},
      },
    ]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].scope, PERSONAL_SCOPE);
    assert.equal(hits[0].confidence, 0.95);
  });

  await test("bounded store deterministic eviction", () => {
    const store = createPersonalKnowledgeStore({ maxEntries: 2 });
    store.upsert({
      id: "1",
      actorKey: "telegram:1",
      domain: "Knowledge",
      content: "a",
      normalizedContent: "a",
      confidence: 1,
      evidence: {},
      sourceType: "user_text",
      entities: [],
      createdAt: 1,
      updatedAt: 1,
      status: "active",
      requestKey: "r1",
      idempotencyKey: "req:r1",
      scope: "personal",
    });
    store.upsert({
      id: "2",
      actorKey: "telegram:1",
      domain: "Knowledge",
      content: "b",
      normalizedContent: "b",
      confidence: 1,
      evidence: {},
      sourceType: "user_text",
      entities: [],
      createdAt: 2,
      updatedAt: 2,
      status: "active",
      requestKey: "r2",
      idempotencyKey: "req:r2",
      scope: "personal",
    });
    store.upsert({
      id: "3",
      actorKey: "telegram:1",
      domain: "Knowledge",
      content: "c",
      normalizedContent: "c",
      confidence: 1,
      evidence: {},
      sourceType: "user_text",
      entities: [],
      createdAt: 3,
      updatedAt: 3,
      status: "active",
      requestKey: "r3",
      idempotencyKey: "req:r3",
      scope: "personal",
    });
    assert.equal(store.size(), 2);
    assert.equal(store.getById("telegram:1", "1"), null);
    assert.ok(store.getById("telegram:1", "3"));
  });

  await test("world adapter failure returns empty", async () => {
    const adapter = createWorldKnowledgeAdapter({
      searchWorldFn: async () => {
        throw new Error("boom");
      },
    });
    const hits = await adapter.search("x", { actorKey: "telegram:1" });
    assert.deepEqual(hits, []);
  });

  console.log(`\npersonal-knowledge-engine: ${passed} passed, ${failed} failed`);
}

run();
