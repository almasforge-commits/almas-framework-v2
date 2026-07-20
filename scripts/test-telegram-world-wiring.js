/**
 * D-028 — Telegram World Knowledge wiring tests.
 * Isolated; does not start bot; does not modify .env.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getWorldKnowledgeConfig,
  WORLD_KNOWLEDGE_MODES,
} from "../config/worldKnowledge.js";
import {
  createWorldKnowledgeForTelegram,
  isWorldKnowledgeWiringEnabled,
} from "../services/worldKnowledge/worldKnowledgeFactory.js";
import { createStaticProvider } from "../services/worldKnowledge/mockProviders.js";
import {
  createTelegramAnswerEngine,
  createTelegramAnswerEngineWithWorld,
} from "../services/answer/telegramAnswerFactory.js";
import { classifyAnswerRouteIntent } from "../services/answer/answerQuestionGate.js";
import { formatTelegramAnswerReply } from "../services/answer/formatTelegramAnswer.js";
import { maybeHandleAnswerQuestion } from "../handlers/routes/answerRoute.js";
import { createAnswerResult } from "../services/answer/answerContracts.js";

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

function envOff() {
  return {
    WORLD_KNOWLEDGE_ENABLED: "false",
    WORLD_KNOWLEDGE_MODE: "off",
  };
}

function envMode(mode) {
  return {
    WORLD_KNOWLEDGE_ENABLED: "true",
    WORLD_KNOWLEDGE_MODE: mode,
    WORLD_KNOWLEDGE_MAX_RESULTS: "10",
    WORLD_KNOWLEDGE_TIMEOUT_MS: "2000",
  };
}

await test("1. default config disables gateway construction", async () => {
  const cfg = getWorldKnowledgeConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.mode, WORLD_KNOWLEDGE_MODES.OFF);
  assert.equal(cfg.effectiveMode, WORLD_KNOWLEDGE_MODES.OFF);
  assert.equal(isWorldKnowledgeWiringEnabled({}), false);

  const wk = await createWorldKnowledgeForTelegram({ env: {} });
  assert.equal(wk.gateway, null);
  assert.equal(wk.mode, "off");
});

await test("2. off mode produces zero provider calls", async () => {
  let searches = 0;
  const provider = {
    id: "spy",
    async initialize() {},
    async health() {
      return { ok: true };
    },
    async shutdown() {},
    async search() {
      searches += 1;
      return [];
    },
  };

  const wk = await createWorldKnowledgeForTelegram({
    env: envOff(),
    providers: [provider],
  });
  assert.equal(wk.gateway, null);

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envOff(),
    worldProviders: [provider],
    retrievePersonal: async () => [],
    searchWorld: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
  });
  assert.equal(searches, 0);
});

await test("3. shadow mode calls gateway for qualifying world question", async () => {
  const audits = [];
  let searches = 0;
  const provider = createCountingProvider(() => {
    searches += 1;
  });

  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("shadow"),
    providers: [provider],
    onAudit: (e) => audits.push(e),
  });
  assert.equal(wk.mode, "shadow");
  assert.ok(wk.gateway);

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("shadow"),
    worldKnowledge: wk,
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });

  assert.ok(searches >= 1);
  assert.ok(audits.length >= 1);
  assert.equal(audits[0].attempted, true);
  assert.equal(result.usedWorldKnowledge, false);
});

await test("4. shadow mode does not alter Telegram answer", async () => {
  const provider = createStaticProvider();

  const offBundle = await createTelegramAnswerEngineWithWorld({
    env: envOff(),
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const shadowWk = await createWorldKnowledgeForTelegram({
    env: envMode("shadow"),
    providers: [provider],
    onAudit: () => {},
  });

  const shadowBundle = await createTelegramAnswerEngineWithWorld({
    env: envMode("shadow"),
    worldKnowledge: shadowWk,
    worldKnowledgeGateway: shadowWk.gateway,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const q = {
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  };
  const offResult = await offBundle.engine.answer(q);
  const shadowResult = await shadowBundle.engine.answer(q);

  assert.equal(
    formatTelegramAnswerReply(offResult),
    formatTelegramAnswerReply(shadowResult)
  );
  assert.equal(shadowResult.usedWorldKnowledge, false);
});

await test("5. active mode uses world evidence", async () => {
  const provider = createStaticProvider();
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
  });
  assert.equal(wk.mode, "active");

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("active"),
    worldKnowledge: wk,
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });

  assert.equal(result.usedWorldKnowledge, true);
  assert.ok(Array.isArray(result.worldSources));
  assert.ok(result.worldSources.length >= 1);
});

await test("6. personal-only question skips gateway", async () => {
  let searches = 0;
  const provider = createCountingProvider(() => {
    searches += 1;
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
  });

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("active"),
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [
      {
        id: "f1",
        subject: "user",
        predicate: "has",
        object: "tasks",
        summary: "You have tasks.",
        confidence: 0.9,
        domain: "Tasks",
      },
    ],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [{ id: 1, text: "Buy milk" }],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  await engine.answer({
    actorKey: "telegram:1",
    query: "My tasks",
  });
  assert.equal(searches, 0);
});

await test("7. execution request skips gateway", async () => {
  let searches = 0;
  const provider = createCountingProvider(() => {
    searches += 1;
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
  });

  const c = classifyAnswerRouteIntent("потратил 100 рублей на кофе");
  assert.equal(c.useAnswerEngine, false);

  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "потратил 100 рублей на кофе",
      from: { id: 1 },
      actor: { actorKey: "telegram:1" },
    },
    {
      sendMessageFn: async () => {},
      engineOverrides: {
        env: envMode("active"),
        worldKnowledgeGateway: wk.gateway,
      },
    }
  );
  assert.equal(r.handled, false);
  assert.equal(searches, 0);
});

await test("8. navigation skips gateway", async () => {
  let searches = 0;
  const provider = createCountingProvider(() => {
    searches += 1;
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
  });

  const texts = ["меню", "финансы", "задачи"];
  for (const text of texts) {
    const c = classifyAnswerRouteIntent(text);
    assert.equal(c.useAnswerEngine, false, text);
    const r = await maybeHandleAnswerQuestion(
      {
        chatId: 1,
        text,
        from: { id: 1 },
        actor: { actorKey: "telegram:1" },
      },
      {
        sendMessageFn: async () => {},
        engineOverrides: {
          env: envMode("active"),
          worldKnowledgeGateway: wk.gateway,
        },
      }
    );
    assert.equal(r.handled, false, text);
  }
  assert.equal(searches, 0);
});

await test("9. gateway unavailable falls back safely", async () => {
  const badGateway = {
    search: async () => {
      throw new Error("gateway_down");
    },
  };

  const engine = createTelegramAnswerEngine({
    env: envMode("active"),
    worldKnowledgeGateway: badGateway,
    retrievePersonal: async () => [
      {
        id: "p1",
        content: "I track sleep with WHOOP.",
        summary: "I track sleep with WHOOP.",
        confidence: 0.95,
        domain: "Health",
        subject: "user",
        predicate: "tracks",
        object: "sleep",
      },
    ],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What do you know about WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });

  assert.equal(result.execution.type, "none");
  assert.equal(result.usedWorldKnowledge, false);
  assert.equal(result.usedPersonalKnowledge, true);
  const reply = formatTelegramAnswerReply(result);
  assert.ok(!/gateway_down|stack|Error:/i.test(reply));
});

await test("10. gateway timeout falls back safely", async () => {
  const slow = {
    id: "slow",
    async initialize() {},
    async health() {
      return { ok: true };
    },
    async shutdown() {},
    async search() {
      await new Promise((r) => setTimeout(r, 500));
      return [
        {
          provider: "slow",
          title: "Late",
          summary: "Should not arrive",
          url: "https://example.invalid/late",
          confidence: 0.9,
          sourceType: "web",
          language: "en",
          publishedAt: Date.now(),
        },
      ];
    },
  };

  const wk = await createWorldKnowledgeForTelegram({
    env: {
      ...envMode("active"),
      WORLD_KNOWLEDGE_TIMEOUT_MS: "30",
    },
    providers: [slow],
    cache: null,
  });

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: { ...envMode("active"), WORLD_KNOWLEDGE_TIMEOUT_MS: "30" },
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });

  assert.equal(result.usedWorldKnowledge, false);
  assert.equal(result.execution.type, "none");
});

await test("11. personal evidence still wins", async () => {
  const provider = {
    id: "world_tea",
    async initialize() {},
    async health() {
      return { ok: true };
    },
    async shutdown() {},
    async search() {
      return [
        {
          provider: "world_tea",
          title: "Tea",
          summary: "People do not drink tea.",
          url: "https://example.invalid/tea",
          confidence: 0.9,
          sourceType: "web",
          language: "en",
          publishedAt: Date.parse("2020-01-01"),
        },
      ];
    },
  };

  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
    cache: null,
  });

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("active"),
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [
      {
        id: "pf",
        summary: "I drink tea every morning.",
        content: "I drink tea every morning.",
        confidence: 0.95,
        domain: "Habits",
        subject: "user",
        predicate: "drinks",
        object: "tea",
      },
    ],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "Do I drink tea?",
    planOverrides: {
      includeWorld: true,
      includeDomains: false,
      includeReasoning: false,
    },
  });

  assert.equal(result.usedPersonalKnowledge, true);
  assert.ok(
    String(result.answer || "").toLowerCase().includes("drink tea") ||
      result.usedPersonalKnowledge
  );
  if (Array.isArray(result.conflicts) && result.conflicts.length) {
    assert.equal(result.conflicts[0].resolutionPolicy, "personal_priority");
  }
});

await test("12. conflicts preserved", async () => {
  const provider = {
    id: "world_conflict",
    async initialize() {},
    async health() {
      return { ok: true };
    },
    async shutdown() {},
    async search() {
      return [
        {
          provider: "world_conflict",
          title: "Negation",
          summary: "I do not drink tea.",
          url: "https://example.invalid/no-tea",
          confidence: 0.8,
          sourceType: "web",
          language: "en",
          publishedAt: Date.now(),
        },
      ];
    },
  };
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
    cache: null,
  });
  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("active"),
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [
      {
        id: "pf",
        summary: "I drink tea.",
        content: "I drink tea.",
        confidence: 0.95,
        domain: "Habits",
      },
    ],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "tea habits explanation",
    planOverrides: {
      includeWorld: true,
      includeDomains: false,
      includeReasoning: false,
    },
  });

  assert.ok(Array.isArray(result.conflicts));
  if (result.conflicts.length) {
    assert.ok(result.conflicts[0].personalEvidence);
    assert.ok(result.conflicts[0].worldEvidence);
    assert.equal(result.conflicts[0].resolutionPolicy, "personal_priority");
  }
});

await test("13. provenance preserved", async () => {
  const provider = createStaticProvider();
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
  });
  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("active"),
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });

  assert.ok(result.worldSources?.length);
  const src = result.worldSources[0];
  for (const key of [
    "provider",
    "retrievedAt",
    "url",
    "sourceType",
    "confidence",
    "language",
    "publishedAt",
  ]) {
    assert.ok(src[key] != null, `missing ${key}`);
  }
});

await test("14. world results never persisted", async () => {
  let pkWrites = 0;
  const provider = createStaticProvider();
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("active"),
    providers: [provider],
  });

  const personalEngine = {
    retrieve: async () => [],
    ingest: async () => {
      pkWrites += 1;
    },
    upsertFact: async () => {
      pkWrites += 1;
    },
    save: async () => {
      pkWrites += 1;
    },
  };

  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: envMode("active"),
    worldKnowledgeGateway: wk.gateway,
    personalKnowledgeEngine: personalEngine,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });

  await engine.answer({
    actorKey: "telegram:1",
    query: "What is WHOOP?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  assert.equal(pkWrites, 0);
});

await test("15. no raw provider payload in logs", async () => {
  const lines = [];
  const provider = createStaticProvider();
  const wk = await createWorldKnowledgeForTelegram({
    env: envMode("shadow"),
    providers: [provider],
    onAudit: (e) => {
      lines.push(JSON.stringify(e));
    },
    logger: {
      log: (s) => lines.push(String(s)),
      error: (s) => lines.push(String(s)),
    },
  });

  await wk.gateway.search("What is WHOOP?");
  const blob = lines.join("\n");
  assert.ok(!/example\.invalid/i.test(blob));
  assert.ok(!/wearable fitness/i.test(blob));
  assert.ok(!/"title"/i.test(blob));
  assert.ok(!/https?:\/\//i.test(blob));
  assert.match(blob, /attempted|providersCalled|resultsReceived|latencyMs|reason/);
});

await test("16. factory works without gateway", async () => {
  const engine = createTelegramAnswerEngine({
    env: envOff(),
    worldKnowledgeGateway: null,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });
  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What is MCP?",
  });
  assert.equal(result.execution.type, "none");
  assert.equal(result.usedWorldKnowledge, false);
});

await test("20. no Supabase schema / API / Mini App / .env changes in this milestone", async () => {
  // Guard: wiring files must not reference Mini App routes or migration SQL writers.
  const factory = readFileSync(
    join(root, "services/worldKnowledge/worldKnowledgeFactory.js"),
    "utf8"
  );
  const telegramFactory = readFileSync(
    join(root, "services/answer/telegramAnswerFactory.js"),
    "utf8"
  );
  const route = readFileSync(
    join(root, "handlers/routes/answerRoute.js"),
    "utf8"
  );
  for (const src of [factory, telegramFactory, route]) {
    assert.ok(!/supabase\/migrations/i.test(src));
    assert.ok(!/mini-app/i.test(src));
    assert.ok(!/VITE_/i.test(src));
  }
});

function createCountingProvider(onSearch) {
  return {
    id: "counting",
    async initialize() {},
    async health() {
      return { ok: true };
    },
    async shutdown() {},
    async search(query) {
      onSearch?.(query);
      return [
        {
          provider: "counting",
          title: "WHOOP",
          summary: "WHOOP is a wearable fitness tracker brand.",
          url: "https://example.invalid/whoop",
          confidence: 0.7,
          sourceType: "web",
          language: "en",
          publishedAt: Date.parse("2021-06-01"),
        },
      ];
    },
  };
}

console.log(`\ntelegram-world-wiring: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
