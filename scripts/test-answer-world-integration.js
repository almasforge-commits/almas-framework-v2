/**
 * Answer Engine ↔ World Knowledge Gateway integration tests (D-027).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createIsolatedAnswerEngine,
  decideWorldRetrieval,
  planAnswerRetrieval,
} from "../services/answer/index.js";
import {
  createIsolatedWorldKnowledgeGateway,
  createStaticProvider,
  createMockNewsProvider,
  createMockResearchProvider,
  createMockDocumentationProvider,
  registerDefaultMockProviders,
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

async function makeGateway(withDefaults = true) {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  if (withDefaults) {
    await registerDefaultMockProviders(gw.manager);
  }
  return gw;
}

await test("world skipped for personal-only queries", async () => {
  for (const q of [
    "My tasks",
    "My ideas",
    "My projects",
    "My expenses",
    "My goals",
    "My notes",
    "мои задачи",
    "мои идеи",
  ]) {
    const d = decideWorldRetrieval(q);
    assert.equal(d.includeWorld, false, q);
    assert.equal(d.reason, "personal_only", q);
    const plan = planAnswerRetrieval({ query: q, actorKey: "telegram:1" });
    assert.equal(plan.includeWorld, false, q);
  }
});

await test("external questions request world retrieval", async () => {
  for (const q of [
    "What is MCP?",
    "What happened with OpenAI?",
    "What is Bitcoin?",
    "Latest AI news",
    "Explain Kubernetes",
    "Что такое MCP?",
  ]) {
    const d = decideWorldRetrieval(q);
    assert.equal(d.includeWorld, true, q);
  }
});

await test("personal-only question does not call gateway", async () => {
  let called = false;
  const gw = {
    search: async () => {
      called = true;
      return { ok: true, results: [] };
    },
  };
  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: gw,
    worldGatewayForceEnabled: true,
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "t1",
          content: "Buy milk",
          confidence: 0.9,
          scope: "personal",
          domain: "Tasks",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
      ],
    }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "My tasks",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  assert.equal(called, false);
  assert.equal(r.usedWorldKnowledge, false);
  assert.equal(r.usedPersonalKnowledge, true);
});

await test("world-only question uses gateway", async () => {
  const gw = await makeGateway();
  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: gw,
    worldGatewayForceEnabled: true,
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  // May clarify if confidence low, but world should be used when results exist
  assert.equal(r.usedWorldKnowledge, true);
  assert.ok(r.worldSources.length >= 1 || r.sources.some((s) => s.scope === "world"));
  assert.ok(
    r.worldSources.every(
      (s) => s.provider && (s.url || s.sourceType) && s.retrievedAt != null
    ) || r.sources.some((s) => s.scope === "world")
  );
});

await test("mixed question — personal priority + conflict", async () => {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  await gw.registerProvider({
    id: "static",
    async initialize() {},
    async health() {
      return { ok: true };
    },
    async shutdown() {},
    async search() {
      return [
        {
          provider: "static",
          title: "Tea habit",
          summary: "I do not drink tea every morning",
          url: "https://example.invalid/tea",
          publishedAt: Date.now(),
          language: "en",
          author: "Static",
          confidence: 0.9,
          sourceType: "web",
          metadata: {},
        },
      ];
    },
  });

  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: gw,
    worldGatewayForceEnabled: true,
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
  });

  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "what do I drink about tea",
    planOverrides: {
      includeWorld: true,
      includeDomains: false,
      includeReasoning: false,
    },
  });
  assert.equal(r.usedPersonalKnowledge, true);
  assert.equal(r.usedWorldKnowledge, true);
  assert.ok(r.conflicts.length >= 1);
  const c = r.conflicts.find((x) => x.type === "personal_vs_world") || r.conflicts[0];
  assert.equal(c.resolutionPolicy, "personal_priority");
  assert.equal(c.preferredScope, "personal");
  assert.ok(c.personalEvidence);
  assert.ok(c.worldEvidence);
  if (r.answer) {
    assert.ok(/tea/i.test(r.answer));
  }
});

await test("provenance preserved on world sources", async () => {
  const gw = await makeGateway(false);
  await gw.registerProvider(createStaticProvider());
  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: gw,
    worldGatewayForceEnabled: true,
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  assert.equal(r.usedWorldKnowledge, true);
  const ws = r.worldSources[0];
  assert.ok(ws.provider);
  assert.ok(ws.url);
  assert.ok(ws.sourceType);
  assert.ok(ws.retrievedAt != null);
});

await test("gateway unavailable does not break Answer Engine", async () => {
  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: {
      search: async () => {
        throw new Error("down");
      },
    },
    worldGatewayForceEnabled: true,
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "1",
          content: "Personal note A",
          confidence: 0.9,
          scope: "personal",
          domain: "Notes",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
        {
          id: "2",
          content: "Personal note B",
          confidence: 0.9,
          scope: "personal",
          domain: "Notes",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
      ],
    }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "What is MCP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  assert.equal(r.execution.type, "none");
  assert.equal(r.usedPersonalKnowledge, true);
});

await test("empty provider list — Answer Engine still works", async () => {
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: gw,
    worldGatewayForceEnabled: true,
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "What is MCP?",
    planOverrides: { includeDomains: false },
  });
  assert.equal(r.usedWorldKnowledge, false);
  assert.equal(r.execution.type, "none");
});

await test("multiple providers merge + ranking stability", async () => {
  const gw = await makeGateway(true);
  const engine = createIsolatedAnswerEngine({
    worldKnowledgeGateway: gw,
    worldGatewayForceEnabled: true,
    retrievePersonal: async () => ({ ok: true, results: [] }),
  });
  const a = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  const b = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  assert.equal(a.usedWorldKnowledge, true);
  assert.deepEqual(
    a.worldSources.map((s) => s.url),
    b.worldSources.map((s) => s.url)
  );
  assert.equal(a.confidence, b.confidence);
});

await test("Answer Engine works without gateway", async () => {
  const engine = createIsolatedAnswerEngine({
    retrievePersonal: async () => ({
      ok: true,
      results: [
        {
          id: "p",
          content: "I prefer quiet mornings",
          confidence: 0.9,
          scope: "personal",
          domain: "Preferences",
          provenance: { provider: "pk", sourceType: "user", retrievedAt: 1 },
        },
      ],
    }),
  });
  const r = await engine.answer({
    actorKey: "telegram:1",
    query: "quiet mornings",
    planOverrides: { includeWorld: false, includeDomains: false },
  });
  assert.equal(r.usedPersonalKnowledge, true);
  assert.equal(r.usedWorldKnowledge, false);
});

await test("confidence reduced when personal/world conflict", async () => {
  const { computeConfidence } = await import(
    "../services/answer/answerComposer.js"
  );
  const { createEvidenceItem } = await import(
    "../services/answer/answerContracts.js"
  );
  const ranked = [
    createEvidenceItem({
      id: "p",
      source: "personal_knowledge",
      scope: "personal",
      confidence: 0.9,
      content: "a",
      score: 0.8,
    }),
    createEvidenceItem({
      id: "w",
      source: "world_knowledge",
      scope: "world",
      confidence: 0.9,
      content: "b",
      score: 0.5,
      provenance: { provider: "static", sourceType: "web", retrievedAt: 1 },
    }),
  ];
  const withConflict = computeConfidence(ranked, [
    { type: "personal_vs_world", resolutionPolicy: "personal_priority" },
  ]);
  const without = computeConfidence(ranked, []);
  assert.ok(withConflict < without);
});

await test("no Answer contract rewrite / no gateway auto-wire in handlers", async () => {
  const mh = readFileSync(join(root, "handlers/messageHandler.js"), "utf8");
  assert.ok(!mh.includes("worldKnowledgeGateway"));
  const ae = readFileSync(join(root, "services/answer/answerEngine.js"), "utf8");
  assert.ok(ae.includes("worldKnowledgeGateway"));
  assert.ok(!ae.includes("createIsolatedWorldKnowledgeGateway"));
});

console.log(`\nanswer-world-integration: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
