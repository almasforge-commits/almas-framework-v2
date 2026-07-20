/**
 * World Knowledge Gateway isolated tests.
 * No HTTP. No Telegram. No Answer Engine wiring.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createIsolatedWorldKnowledgeGateway,
  createWorldKnowledgeGateway,
  createProviderManager,
  createInMemoryWorldCache,
  createStaticProvider,
  createMockNewsProvider,
  createMockResearchProvider,
  createMockDocumentationProvider,
  registerDefaultMockProviders,
  validateProvider,
  validateProviderResult,
  normalizeProviderResult,
  dedupeResults,
  rankWorldResults,
  scoreProviderResult,
  createProviderResult,
  WORLD_KNOWLEDGE_ERROR,
} from "../services/worldKnowledge/index.js";

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

await test("provider registration and removal", async () => {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  await gw.registerProvider(createStaticProvider());
  assert.deepEqual(gw.listProviders(), ["static"]);
  await gw.registerProvider(createMockNewsProvider());
  assert.deepEqual(gw.listProviders(), ["mock_news", "static"]);
  assert.equal(await gw.unregisterProvider("static"), true);
  assert.deepEqual(gw.listProviders(), ["mock_news"]);
});

await test("provider validation", async () => {
  assert.throws(() => validateProvider({}), /provider_missing/);
  assert.throws(
    () => validateProvider({ id: "x", search: async () => [] }),
    /provider_missing/
  );
  validateProvider(createStaticProvider());

  assert.equal(
    validateProviderResult({
      provider: "p",
      title: "T",
      summary: "<b>html</b>",
      sourceType: "web",
    }).ok,
    false
  );
  assert.equal(
    validateProviderResult(
      createProviderResult({
        provider: "p",
        title: "T",
        summary: "plain",
        sourceType: "web",
      })
    ).ok,
    true
  );
});

await test("provider normalization strips markup", async () => {
  const n = normalizeProviderResult({
    provider: "static",
    title: " <b>Hi</b> ",
    summary: "Hello <script>x</script> world",
    sourceType: "web",
    confidence: 0.5,
  });
  assert.ok(n);
  assert.equal(n.title, "Hi");
  assert.ok(!/<[a-z]/i.test(n.summary));
  assert.match(n.summary, /Hello/);
});

await test("normalization after strip allows cleaned text", async () => {
  const n = normalizeProviderResult({
    provider: "static",
    title: "Hi",
    summary: "Hello world",
    sourceType: "web",
    confidence: 0.5,
    url: "https://example.invalid/a",
  });
  assert.ok(n);
  assert.equal(n.title, "Hi");
  assert.ok(!/<[a-z]/i.test(n.summary));
});

await test("duplicate removal", async () => {
  const rows = [
    createProviderResult({
      provider: "a",
      title: "Same",
      summary: "Body",
      url: "https://example.invalid/x",
      sourceType: "web",
      confidence: 0.5,
    }),
    createProviderResult({
      provider: "b",
      title: "Same",
      summary: "Body",
      url: "https://example.invalid/x",
      sourceType: "news",
      confidence: 0.9,
    }),
    createProviderResult({
      provider: "c",
      title: "Other",
      summary: "Else",
      url: "https://example.invalid/y",
      sourceType: "web",
      confidence: 0.4,
    }),
  ];
  const d = dedupeResults(rows);
  assert.equal(d.length, 2);
});

await test("ranking and confidence and provenance", async () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const ranked = rankWorldResults(
    [
      createProviderResult({
        provider: "mock_documentation",
        title: "Docs WHOOP",
        summary: "WHOOP wearable docs",
        url: "https://example.invalid/docs/whoop",
        publishedAt: now - 1000,
        language: "en",
        confidence: 0.8,
        sourceType: "documentation",
        metadata: { quality: 0.9 },
      }),
      createProviderResult({
        provider: "static",
        title: "Static WHOOP",
        summary: "WHOOP is a brand",
        url: "https://example.invalid/static/whoop",
        publishedAt: now - 86_400_000 * 400,
        language: "en",
        confidence: 0.55,
        sourceType: "web",
      }),
    ],
    { nowMs: now, query: "WHOOP", retrievedAt: now }
  );
  assert.ok(ranked.length === 2);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.equal(ranked[0].provenance.provider, ranked[0].provider);
  assert.equal(ranked[0].provenance.sourceType, ranked[0].sourceType);
  assert.ok(ranked[0].provenance.retrievedAt);
  assert.equal(ranked[0].scope, "world");
  const s = scoreProviderResult(ranked[0], { nowMs: now, query: "WHOOP" });
  assert.ok(s > 0);
});

await test("cache hit / miss / TTL expiration", async () => {
  let now = 1_000_000;
  const cache = createInMemoryWorldCache({
    defaultTtlMs: 1000,
    nowFn: () => now,
  });
  assert.equal(cache.get("k"), null);
  cache.set("k", { v: 1 }, 1000);
  assert.deepEqual(cache.get("k"), { v: 1 });
  now += 1001;
  assert.equal(cache.get("k"), null);
});

await test("gateway without providers", async () => {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  const r = await gw.search("WHOOP");
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.equal(r.reason, "no_providers");
});

await test("gateway with one provider", async () => {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  await gw.registerProvider(createStaticProvider());
  const r = await gw.search("Bangkok");
  assert.ok(r.count >= 1);
  assert.equal(r.results[0].provider, "static");
  assert.ok(r.results[0].provenance.url);
});

await test("multi-provider merge and deterministic ordering", async () => {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  await registerDefaultMockProviders(gw.manager);
  const a = await gw.search("WHOOP");
  const b = await gw.search("WHOOP");
  assert.ok(a.count >= 2);
  assert.deepEqual(
    a.results.map((x) => x.url),
    b.results.map((x) => x.url)
  );
  assert.deepEqual(a.providers, [
    "mock_documentation",
    "mock_news",
    "mock_research",
    "static",
  ]);
});

await test("provider failure isolation", async () => {
  const bad = {
    id: "bad",
    async initialize() {},
    async health() {
      return { ok: false };
    },
    async shutdown() {},
    async search() {
      throw new Error("boom");
    },
  };
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  await gw.registerProvider(createStaticProvider());
  await gw.registerProvider(bad);
  const r = await gw.search("Bangkok");
  assert.ok(r.count >= 1);
  assert.ok(r.errors.some((e) => e.provider === "bad"));
  assert.ok(
    r.errors.every((e) => Object.values(WORLD_KNOWLEDGE_ERROR).includes(e.code))
  );
});

await test("gateway cache hit via search", async () => {
  const gw = createIsolatedWorldKnowledgeGateway();
  await gw.registerProvider(createStaticProvider());
  const first = await gw.search("Bangkok");
  assert.equal(first.cacheHit, false);
  const second = await gw.search("Bangkok");
  assert.equal(second.cacheHit, true);
  assert.equal(second.count, first.count);
});

await test("disabled config returns empty without ignore", async () => {
  const gw = createWorldKnowledgeGateway({
    env: {},
    config: {
      enabled: false,
      cacheTtlMs: 1000,
      providerTimeoutMs: 1000,
      maxResults: 10,
      maxPerProvider: 5,
    },
    cache: null,
  });
  await gw.registerProvider(createMockResearchProvider());
  const r = await gw.search("ranking");
  assert.equal(r.reason, "disabled");
  assert.equal(r.count, 0);
});

await test("provider manager list is sorted", async () => {
  const m = createProviderManager();
  await m.registerProvider(createMockNewsProvider());
  await m.registerProvider(createStaticProvider());
  assert.deepEqual(m.listProviders(), ["mock_news", "static"]);
});

await test("no Telegram / Answer Engine / Personal Knowledge coupling", async () => {
  const dir = join(root, "services/worldKnowledge");
  const forbidden = [
    "messageHandler",
    "node-telegram-bot-api",
    "answerEngine",
    "personalKnowledgeEngine",
    "actionExecutor",
    "addExpense",
    "createTask",
    "saveMemory",
    "fetch(",
    "https.request",
  ];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    for (const bad of forbidden) {
      assert.ok(!text.includes(bad), `${f} must not contain ${bad}`);
    }
  }
});

console.log(`\nworld-knowledge-gateway: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
