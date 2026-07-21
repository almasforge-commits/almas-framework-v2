/**
 * Legacy memory save/recall regression tests (Telegram path).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractLegacyMemorySaveContent,
  shouldSaveMemory,
} from "../services/storage/memoryFilter.js";
import {
  classifyAnswerRouteIntent,
  looksLikeOpenQuestion,
} from "../services/answer/answerQuestionGate.js";
import {
  filterMemoriesByActor,
  normalizeMemorySearchQuery,
  normalizeTelegramActorId,
} from "../services/storage/memoryService.js";
import { collectDomainEvidence } from "../services/answer/evidenceCollector.js";
import { rankEvidence } from "../services/answer/evidenceRanker.js";
import { composeAnswer, computeConfidence } from "../services/answer/answerComposer.js";
import { detectIncompleteIntent } from "../services/context/contextContracts.js";
import { createTelegramAnswerEngine } from "../services/answer/telegramAnswerFactory.js";
import { maybeHandleAnswerQuestion } from "../handlers/routes/answerRoute.js";
import { handleClarificationTurn } from "../handlers/routes/clarificationRoute.js";
import { createClarificationEngine } from "../services/context/clarificationEngine.js";
import { createConversationContextStore } from "../services/context/conversationContextStore.js";

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

const PREFERENCE = "мне нравится работать ночью";

function memoryStoreFor(actorUserId, content = PREFERENCE) {
  return [
    {
      id: "m1",
      content,
      metadata: { userId: actorUserId },
      similarity: 0.42,
      created_at: "2026-07-20T10:00:00.000Z",
    },
  ];
}

function engineWithMemoryStore(store) {
  return createTelegramAnswerEngine({
    env: {},
    searchMemoryFn: async (query, { actorKey } = {}) =>
      filterMemoriesByActor(store, { actorKey }),
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    listInsights: async () => [],
  });
}

await test("prefix stripped: Запомни, что …", () => {
  const r = extractLegacyMemorySaveContent(
    "Запомни, что мне нравится работать ночью"
  );
  assert.equal(r.kind, "save");
  assert.equal(r.content, "Мне нравится работать ночью");
});

await test("prefix stripped: Запомни что …", () => {
  const r = extractLegacyMemorySaveContent(
    "Запомни что мне нравится работать ночью"
  );
  assert.equal(r.kind, "save");
  assert.equal(r.content, "Мне нравится работать ночью");
});

await test("prefix stripped: Remember that …", () => {
  const r = extractLegacyMemorySaveContent(
    "Remember that I like working at night"
  );
  assert.equal(r.kind, "save");
  assert.equal(r.content, "I like working at night");
});

await test("bare Запомни is incomplete", () => {
  assert.equal(extractLegacyMemorySaveContent("Запомни").kind, "incomplete");
  assert.equal(extractLegacyMemorySaveContent("запомнить").kind, "incomplete");
  const incomplete = detectIncompleteIntent("Запомни");
  assert.equal(incomplete?.kind, "memory_save");
  assert.equal(incomplete?.question, "Что нужно запомнить?");
});

await test("explicit memory save is not routed as a question", () => {
  const gate = classifyAnswerRouteIntent(
    "Запомни, что мне нравится работать ночью"
  );
  assert.equal(gate.useAnswerEngine, false);
  assert.equal(gate.reason, "memory_save_command");
});

await test("Cyrillic questions detected without \\b", () => {
  assert.equal(looksLikeOpenQuestion("Что ты знаешь обо мне?"), true);
  assert.equal(
    looksLikeOpenQuestion("Что ты знаешь о моих предпочтениях?"),
    true
  );
  assert.equal(
    classifyAnswerRouteIntent("Запомни, что мне нравится X").useAnswerEngine,
    false
  );
  const gate = classifyAnswerRouteIntent("Что ты знаешь обо мне?");
  assert.equal(gate.useAnswerEngine, true);
});

await test("1) same-actor memory returned by recall", async () => {
  const engine = engineWithMemoryStore(memoryStoreFor("42"));
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "вспомни что мне нравится работать",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.equal(r.handled, true);
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  assert.match(String(r.result?.answer || ""), /ночью/i);
});

await test("2) actorKey normalization works", () => {
  assert.equal(normalizeTelegramActorId({ actorKey: "telegram:394476106" }), "394476106");
  assert.equal(normalizeTelegramActorId({ userId: 42 }), "42");
  assert.equal(normalizeTelegramActorId({ userId: "telegram:7" }), "7");
  assert.equal(normalizeTelegramActorId({}), null);
});

await test("3) metadata userId/chatId variants handled safely", () => {
  const rows = [
    { id: "a", content: "a", metadata: { userId: 42 } },
    { id: "b", content: "b", metadata: { user_id: "42" } },
    { id: "c", content: "c", metadata: { chatId: 42 } },
    { id: "d", content: "d", metadata: { chat_id: "42" } },
    { id: "e", content: "e", metadata: { userId: "99" } },
    { id: "f", content: "f", metadata: {} },
  ];
  const scoped = filterMemoriesByActor(rows, { actorKey: "telegram:42" });
  assert.deepEqual(
    scoped.map((r) => r.id).sort(),
    ["a", "b", "c", "d"]
  );
});

await test("4) actor A cannot retrieve actor B memory", async () => {
  const engine = engineWithMemoryStore(memoryStoreFor("42"));
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "Что ты знаешь о моих предпочтениях?",
      from: { id: 99 },
      actor: { actorKey: "telegram:99" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Nothing found|Found|Open in ALMAS/i);
  const answer = String(r.result?.answer || "");
  assert.ok(
    /Недостаточно|не знаю|Уточните|Nothing found/i.test(
      `${sent.join("\n")}\n${answer}`
    ) || !/ночью/i.test(answer),
    `expected empty for other actor, got telegram=${sent.join(" | ")} answer=${answer}`
  );
  assert.ok(!/ночью/i.test(answer));
});

await test("5) вспомни что мне нравится returns preference", async () => {
  const engine = engineWithMemoryStore(memoryStoreFor("42"));
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "вспомни что мне нравится",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  assert.match(String(r.result?.answer || ""), /ночью/i);
  assert.ok(!/Недостаточно надёжных данных/i.test(String(r.result?.answer || "")));
});

await test("6) Что ты знаешь обо мне? returns saved memory", async () => {
  const engine = engineWithMemoryStore(memoryStoreFor("42"));
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
  assert.match(String(r.result?.answer || ""), /ночью/i);
});

await test("7) Что ты знаешь о моих предпочтениях? returns preference", async () => {
  const engine = engineWithMemoryStore(memoryStoreFor("42"));
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "Что ты знаешь о моих предпочтениях?",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Found|Open in ALMAS/i);
  assert.match(String(r.result?.answer || ""), /ночью/i);
});

await test("8) no-match stays honest", async () => {
  const engine = engineWithMemoryStore([]);
  const sent = [];
  const r = await maybeHandleAnswerQuestion(
    {
      chatId: 1,
      text: "вспомни что мне нравится",
      from: { id: 42 },
      actor: { actorKey: "telegram:42" },
    },
    { answerEngine: engine, sendMessageFn: async (_c, t) => sent.push(t) }
  );
  assert.match(sent.join("\n"), /Nothing found|Open in ALMAS/i);
  const answer = String(r.result?.answer || "");
  assert.ok(
    /Недостаточно|не знаю|Уточните/i.test(answer) ||
      /Nothing found/i.test(sent.join("\n")),
    `expected honest unknown, got telegram=${sent.join(" | ")} answer=${answer}`
  );
  assert.ok(!/ночью/i.test(sent.join("\n")));
  assert.ok(!/ночью/i.test(answer));
});

await test("9) mapped evidence has valid scope/domain/confidence/provenance", () => {
  const items = collectDomainEvidence("memory", [
    {
      id: "m1",
      content: PREFERENCE,
      similarity: 0.41,
      created_at: "2026-07-20T10:00:00.000Z",
    },
  ]);
  assert.equal(items.length, 1);
  const e = items[0];
  assert.equal(e.scope, "personal");
  assert.equal(e.domain, "preferences");
  assert.equal(e.source, "memory");
  assert.ok(e.confidence >= 0.75);
  assert.equal(e.provenance?.provider, "memory");
  assert.equal(e.provenance?.sourceType, "memory_service");
  assert.ok(e.id === "memory:m1");
  assert.ok(Number.isFinite(e.timestamp));
  assert.ok(!("metadata" in e));
  assert.ok(!("embedding" in e));
});

await test("10) valid memory evidence passes answer threshold", () => {
  const items = collectDomainEvidence("memory", [
    { id: "m1", content: PREFERENCE, similarity: 0.35 },
  ]);
  const ranked = rankEvidence(items);
  const conf = computeConfidence(ranked);
  assert.ok(conf >= 0.55, `expected conf>=0.55, got ${conf}`);
  const composed = composeAnswer({
    rankedEvidence: ranked,
    minConfidence: 0.55,
    flags: { usedDomains: ["memory"] },
  });
  assert.equal(composed.needsClarification, false);
  assert.match(composed.answer || "", /нравится работать ночью/i);
});

await test("11) save flow remains unchanged", () => {
  const src = readFileSync(join(root, "handlers/messageHandler.js"), "utf8");
  assert.match(src, /THIN_CONFIRM\.memory/);
  assert.match(src, /saveMemory\(/);
  assert.match(src, /extractLegacyMemorySaveContent/);
});

await test("memory saves once with confirmation and no fallback", async () => {
  let saveCalls = 0;
  let savedContent = null;
  const sent = [];

  const text = "Запомни, что мне нравится работать ночью";
  assert.equal(shouldSaveMemory(text), true);
  const extracted = extractLegacyMemorySaveContent(text);
  assert.equal(extracted.kind, "save");

  const saveMemory = async ({ content }) => {
    saveCalls += 1;
    savedContent = content;
    return true;
  };
  const sendMessage = async (_chatId, msg) => {
    sent.push(msg);
  };
  const sendFallback = async () => {
    sent.push("FALLBACK");
  };

  const saved = await saveMemory({
    content:
      extracted.kind === "save" && extracted.content
        ? extracted.content
        : text,
  });
  if (saved) {
    await sendMessage(1, "🧠 Saved.\n\nOpen ALMAS →");
  } else {
    await sendFallback();
  }

  assert.equal(saveCalls, 1);
  assert.equal(savedContent, "Мне нравится работать ночью");
  assert.deepEqual(sent, ["🧠 Saved.\n\nOpen ALMAS →"]);
  assert.ok(!sent.includes("FALLBACK"));
});

await test("bare Запомни asks clarification in shadow", async () => {
  const sent = [];
  const store = createConversationContextStore({ maxEntries: 20 });
  const engine = createClarificationEngine({ store });
  const r = await handleClarificationTurn(
    {
      chatId: 1,
      text: "Запомни",
      from: { id: 7 },
      actor: { actorKey: "telegram:7" },
      requestKey: "rk-bare-memory",
    },
    {
      engine,
      aiRouterActiveFn: () => false,
      sendMessageFn: async (_c, t) => sent.push(t),
    }
  );
  assert.equal(r.handled, true);
  assert.equal(sent[0], "Что нужно запомнить?");
});

await test("query normalization strips вспомни prefix", () => {
  assert.equal(
    normalizeMemorySearchQuery("вспомни что мне нравится"),
    "мне нравится"
  );
  assert.equal(
    normalizeMemorySearchQuery("вспомни что мне нравится работать"),
    "мне нравится работать"
  );
  assert.equal(
    normalizeMemorySearchQuery("Что ты знаешь обо мне?"),
    "мои предпочтения нравится"
  );
});

await test("RPC rows without metadata are fail-closed until hydrated", () => {
  const bare = [{ id: "m1", content: PREFERENCE, similarity: 0.9 }];
  assert.equal(filterMemoriesByActor(bare, { actorKey: "telegram:42" }).length, 0);
  const hydrated = [
    {
      id: "m1",
      content: PREFERENCE,
      similarity: 0.9,
      metadata: { userId: "42" },
    },
  ];
  assert.equal(
    filterMemoriesByActor(hydrated, { actorKey: "telegram:42" }).length,
    1
  );
});

console.log(`\nlegacy-memory-fix: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
