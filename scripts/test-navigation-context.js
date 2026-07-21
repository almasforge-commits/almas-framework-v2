/**
 * D-032 — Telegram navigation context + exact domain commands.
 */

import assert from "node:assert/strict";
import { createNavigationContextStore } from "../services/navigation/navigationContextStore.js";
import {
  createNavigationContext,
  NAV_CONTEXT_TTL_MS,
} from "../services/navigation/navigationContracts.js";
import {
  parseExactDomainCommand,
  resolveNavigationInput,
  shouldDeferMeaninglessForNav,
  isNavigationOrDomainOpenCommand,
} from "../services/navigation/navigationResolver.js";
import {
  maybeHandleNavigation,
  setNavigationListContext,
} from "../services/navigation/navigationRoute.js";
import { shouldSaveMemory } from "../services/storage/memoryFilter.js";
import {
  sendKnowledgeMenu,
  sendIdeasMenu,
  sendMainMenu,
} from "../handlers/routes/menuRoute.js";
import { isMeaninglessShortInput } from "../core/utils/isMeaninglessShortInput.js";

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

function spy() {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

const knowledgeFixtures = [
  { id: "k1", title: "Знание 1", summary: "s1", keyPoints: [], ideas: [], tasks: [], tags: [] },
  { id: "k2", title: "Знание 2", summary: "s2", keyPoints: [], ideas: [], tasks: [], tags: [] },
  { id: "k3", title: "Знание 3", summary: "s3", keyPoints: [], ideas: [], tasks: [], tags: [] },
  { id: "k4", title: "Знание 4", summary: "s4", keyPoints: [], ideas: [], tasks: [], tags: [] },
];

const ideaFixtures = [
  { id: "i1", title: "Идея 1", normalizedText: "Идея 1", category: "other", relatedIdeaIds: [] },
  { id: "i2", title: "Идея 2", normalizedText: "Идея 2", category: "content", relatedIdeaIds: [] },
];

await test("1. Knowledge list → bare 4 opens knowledge 4", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  setNavigationListContext(store, "telegram:1", "c1", "knowledge", [
    { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 },
  ]);

  const result = await maybeHandleNavigation(
    { chatId: "c1", text: "4", actor: { actorKey: "telegram:1" } },
    {
      store,
      sendMessageFn,
      getKnowledgeByIndexFn: async (i) => knowledgeFixtures[i - 1] || null,
    }
  );
  assert.equal(result.handled, true);
  assert.match(sendMessageFn.calls[0][1], /Knowledge ready/);
});

await test("2. Knowledge list → открой 4 opens knowledge 4", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  setNavigationListContext(store, "telegram:1", "c1", "knowledge", [
    { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 },
  ]);

  const result = await maybeHandleNavigation(
    { chatId: "c1", text: "открой 4", actor: { actorKey: "telegram:1" } },
    {
      store,
      sendMessageFn,
      getKnowledgeByIndexFn: async (i) => knowledgeFixtures[i - 1] || null,
    }
  );
  assert.equal(result.handled, true);
  assert.match(sendMessageFn.calls[0][1], /Knowledge ready/);
});

await test("3. открой знание 4 never saves Memory", () => {
  assert.equal(shouldSaveMemory("открой знание 4"), false);
  assert.equal(shouldSaveMemory("открыть знание 4"), false);
  assert.equal(shouldSaveMemory("знание 4"), false);
  assert.equal(shouldSaveMemory("покажи знание 4"), false);
  assert.equal(isNavigationOrDomainOpenCommand("открой знание 4"), true);
  assert.ok(parseExactDomainCommand("открой знание 4"));
});

await test("4. Without context, bare 4 stays meaningless", () => {
  const store = createNavigationContextStore();
  const ctx = store.peek("telegram:1", "c1");
  assert.equal(ctx, null);
  assert.equal(isMeaninglessShortInput("4"), true);
  assert.equal(shouldDeferMeaninglessForNav("4", null), false);
  const resolved = resolveNavigationInput("4", null);
  assert.equal(resolved.handled, false);
});

await test("5. Ideas list → 2 opens idea 2", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  setNavigationListContext(store, "telegram:1", "c1", "ideas", [
    { index: 1, id: "i1" },
    { index: 2, id: "i2" },
  ]);

  const result = await maybeHandleNavigation(
    { chatId: "c1", text: "2", actor: { actorKey: "telegram:1" } },
    {
      store,
      sendMessageFn,
      getIdeaByListIndexFn: async (_a, index) => ({
        idea: ideaFixtures[index - 1] || null,
        index,
        total: 2,
      }),
      resolveRelatedFn: async () => [],
    }
  );
  assert.equal(result.handled, true);
  assert.match(sendMessageFn.calls[0][1], /Idea ready/);
});

await test("6. открой идею 2 works without context", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  assert.equal(store.peek("telegram:1", "c1"), null);

  const result = await maybeHandleNavigation(
    { chatId: "c1", text: "открой идею 2", actor: { actorKey: "telegram:1" } },
    {
      store,
      sendMessageFn,
      getIdeaByListIndexFn: async (_a, index) => ({
        idea: ideaFixtures[index - 1] || null,
        index,
        total: 2,
      }),
      resolveRelatedFn: async () => [],
    }
  );
  assert.equal(result.handled, true);
  assert.match(sendMessageFn.calls[0][1], /Idea ready/);
  assert.equal(shouldSaveMemory("открой идею 2"), false);
});

await test("7. Switching Knowledge → Ideas replaces context", async () => {
  const store = createNavigationContextStore();
  await sendKnowledgeMenu("c1", {
    sendMessageFn: spy(),
    actorKey: "telegram:1",
    navigationStore: store,
    getAllKnowledgeFn: async () => knowledgeFixtures,
  });
  assert.equal(store.peek("telegram:1", "c1")?.section, "knowledge");

  await sendIdeasMenu("c1", {
    sendMessageFn: spy(),
    actorKey: "telegram:1",
    navigationStore: store,
    listIdeasFn: async () => ({ ideas: ideaFixtures, total: 2, pageSize: 10 }),
  });
  const ctx = store.peek("telegram:1", "c1");
  assert.equal(ctx.section, "ideas");
  // Thin menus keep section context without dumping list items into Telegram.
  assert.ok(Array.isArray(ctx.items));
});

await test("8. Context expires after TTL", () => {
  let now = 1_000_000;
  const store = createNavigationContextStore({
    nowFn: () => now,
    ttlMs: 1000,
  });
  store.set("telegram:1", "c1", {
    section: "knowledge",
    screen: "list",
    items: [{ index: 1 }],
  });
  assert.ok(store.peek("telegram:1", "c1"));
  now += 1001;
  assert.equal(store.peek("telegram:1", "c1"), null);
  assert.ok(NAV_CONTEXT_TTL_MS >= 10 * 60 * 1000);
  assert.ok(NAV_CONTEXT_TTL_MS <= 15 * 60 * 1000);
});

await test("9. Actor A context invisible to Actor B", () => {
  const store = createNavigationContextStore();
  store.set("telegram:A", "c1", {
    section: "knowledge",
    items: [{ index: 1 }],
  });
  assert.ok(store.peek("telegram:A", "c1"));
  assert.equal(store.peek("telegram:B", "c1"), null);
  const resolved = resolveNavigationInput("1", store.peek("telegram:B", "c1"));
  assert.equal(resolved.handled, false);
});

await test("10. Chat A context invisible to Chat B", () => {
  const store = createNavigationContextStore();
  store.set("telegram:1", "chatA", {
    section: "ideas",
    items: [{ index: 1 }],
  });
  assert.ok(store.peek("telegram:1", "chatA"));
  assert.equal(store.peek("telegram:1", "chatB"), null);
});

await test("11. назад / список / следующее / предыдущее for Knowledge+Ideas", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  setNavigationListContext(store, "telegram:1", "c1", "knowledge", [
    { index: 1 }, { index: 2 }, { index: 3 },
  ]);
  store.update("telegram:1", "c1", { screen: "item", cursor: 2 });

  let r = resolveNavigationInput("следующее", store.peek("telegram:1", "c1"));
  assert.equal(r.action.index, 3);
  r = resolveNavigationInput("предыдущее", store.peek("telegram:1", "c1"));
  assert.equal(r.action.index, 1);
  r = resolveNavigationInput("список", store.peek("telegram:1", "c1"));
  assert.equal(r.action.type, "show_list");
  r = resolveNavigationInput("назад", store.peek("telegram:1", "c1"));
  assert.equal(r.action.type, "show_list");

  setNavigationListContext(store, "telegram:1", "c1", "ideas", [
    { index: 1 }, { index: 2 },
  ]);
  store.update("telegram:1", "c1", { screen: "item", cursor: 1 });
  r = resolveNavigationInput("следующее", store.peek("telegram:1", "c1"));
  assert.equal(r.action.section, "ideas");
  assert.equal(r.action.index, 2);

  await maybeHandleNavigation(
    { chatId: "c1", text: "список", actor: { actorKey: "telegram:1" } },
    {
      store,
      sendMessageFn,
      getAllKnowledgeFn: async () => knowledgeFixtures,
      listIdeasFn: async () => ({ ideas: ideaFixtures, total: 2, pageSize: 10 }),
    }
  );
  assert.ok(sendMessageFn.calls.length >= 1);
  assert.match(sendMessageFn.calls[0][1], /Ideas|ideas found|Knowledge/i);
});

await test("12. Task completion in tasks context", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  setNavigationListContext(store, "telegram:1", "c1", "tasks", [
    { index: 1, content: "A" },
    { index: 2, content: "B" },
    { index: 3, content: "C" },
  ]);

  let completedIndex = null;
  const result = await maybeHandleNavigation(
    { chatId: "c1", text: "выполнено 3", actor: { actorKey: "telegram:1" } },
    {
      store,
      sendMessageFn,
      completeTaskFn: async (index) => {
        completedIndex = index;
        return { content: "C" };
      },
    }
  );
  assert.equal(result.handled, true);
  assert.equal(completedIndex, 3);
  assert.match(sendMessageFn.calls[0][1], /Done|Open Tasks/);

  // Outside tasks context, выполнено falls through
  setNavigationListContext(store, "telegram:1", "c1", "knowledge", [
    { index: 1 },
  ]);
  const skip = resolveNavigationInput(
    "выполнено 3",
    store.peek("telegram:1", "c1")
  );
  assert.equal(skip.handled, false);
});

await test("13. Finance ignores bare numbers; shortcuts work", () => {
  const ctx = createNavigationContext({
    section: "finance",
    screen: "summary",
    items: [],
  });
  assert.equal(shouldDeferMeaninglessForNav("4", ctx), false);
  assert.equal(resolveNavigationInput("4", ctx).handled, false);
  assert.equal(resolveNavigationInput("баланс", ctx).action?.type, "finance_shortcut");
  assert.equal(resolveNavigationInput("история", ctx).action?.shortcut, "history");
  assert.equal(resolveNavigationInput("неделя", ctx).action?.shortcut, "week");
});

await test("14. Memory open from context; exact commands blocked from Memory save", async () => {
  const store = createNavigationContextStore();
  const sendMessageFn = spy();
  setNavigationListContext(store, "telegram:1", "c1", "memory", [
    { index: 1, content: "Факт один" },
    { index: 2, content: "Факт два" },
  ]);

  const result = await maybeHandleNavigation(
    { chatId: "c1", text: "2", actor: { actorKey: "telegram:1" } },
    { store, sendMessageFn }
  );
  assert.equal(result.handled, true);
  assert.match(sendMessageFn.calls[0][1], /Memory ready/);

  assert.equal(shouldSaveMemory("открой память 1"), false);
  assert.equal(shouldSaveMemory("идея 2"), false);
  assert.equal(shouldSaveMemory("задача 1"), false);
});

await test("15. Home clears context; voice-safe domain opens never Memory", async () => {
  const store = createNavigationContextStore();
  setNavigationListContext(store, "telegram:1", "c1", "knowledge", [
    { index: 1 },
  ]);
  await sendMainMenu("c1", {
    sendMessageFn: spy(),
    actorKey: "telegram:1",
    navigationStore: store,
  });
  assert.equal(store.peek("telegram:1", "c1"), null);

  // Destructive / nav phrases remain non-Memory (voice uses same filter)
  assert.equal(shouldSaveMemory("удалить все знания"), false);
  assert.equal(shouldSaveMemory("открой 4"), false);
  assert.equal(shouldSaveMemory("покажи 2"), false);
  assert.equal(shouldSaveMemory("следующее"), false);
  assert.equal(shouldSaveMemory("список"), false);
});

await test("16. After idea open, sequential numbers work and no Main menu", async () => {
  const store = createNavigationContextStore();
  const msgs = [];
  const sendMessageFn = async (_c, t) => {
    msgs.push(String(t));
  };
  const sendMainMenuFn = async () => {
    msgs.push("MAIN_MENU");
  };
  const ideas = [
    { id: "i1", title: "A", normalizedText: "A", category: "other", relatedIdeaIds: [] },
    { id: "i2", title: "B", normalizedText: "B", category: "other", relatedIdeaIds: [] },
    { id: "i3", title: "C", normalizedText: "C", category: "other", relatedIdeaIds: [] },
    { id: "i4", title: "D", normalizedText: "D", category: "other", relatedIdeaIds: [] },
  ];
  const deps = {
    store,
    sendMessageFn,
    sendMainMenuFn,
    getIdeaByListIndexFn: async (_a, i) => ({
      idea: ideas[i - 1] || null,
      index: i,
      total: 4,
    }),
    resolveRelatedFn: async () => [],
  };

  setNavigationListContext(store, "telegram:1", "c1", "ideas", [
    { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 },
  ]);

  for (const n of ["3", "4", "2"]) {
    const r = await maybeHandleNavigation(
      { chatId: "c1", text: n, actor: { actorKey: "telegram:1" } },
      deps
    );
    assert.equal(r.handled, true, `expected open for ${n}`);
    assert.match(msgs.at(-1), /Idea ready/);
  }

  assert.ok(!msgs.includes("MAIN_MENU"));
  assert.ok(!msgs.some((m) => /ALMAS готов/.test(m)));
  assert.equal(store.peek("telegram:1", "c1")?.section, "ideas");
  assert.equal(store.peek("telegram:1", "c1")?.screen, "item");
  assert.equal(store.peek("telegram:1", "c1")?.cursor, 2);
});

await test("17. After knowledge open, sequential numbers work and no Main menu", async () => {
  const store = createNavigationContextStore();
  const msgs = [];
  const sendMessageFn = async (_c, t) => {
    msgs.push(String(t));
  };
  const sendMainMenuFn = async () => {
    msgs.push("MAIN_MENU");
  };

  setNavigationListContext(store, "telegram:1", "c1", "knowledge", [
    { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 },
  ]);

  for (const n of ["4", "2", "1"]) {
    const r = await maybeHandleNavigation(
      { chatId: "c1", text: n, actor: { actorKey: "telegram:1" } },
      {
        store,
        sendMessageFn,
        sendMainMenuFn,
        getKnowledgeByIndexFn: async (i) => knowledgeFixtures[i - 1] || null,
      }
    );
    assert.equal(r.handled, true);
    assert.match(msgs.at(-1), /Knowledge ready/);
  }

  assert.ok(!msgs.includes("MAIN_MENU"));
  const ctx = store.peek("telegram:1", "c1");
  assert.equal(ctx?.section, "knowledge");
  assert.equal(ctx?.cursor, 1);
});

await test("18. Main menu then bare 4 does not open; следующая/предыдущая work", async () => {
  const store = createNavigationContextStore();
  setNavigationListContext(store, "telegram:1", "c1", "ideas", [
    { index: 1 }, { index: 2 },
  ]);
  await sendMainMenu("c1", {
    sendMessageFn: spy(),
    actorKey: "telegram:1",
    navigationStore: store,
  });
  assert.equal(store.peek("telegram:1", "c1"), null);
  assert.equal(resolveNavigationInput("4", null).handled, false);

  setNavigationListContext(store, "telegram:1", "c1", "ideas", [
    { index: 1 }, { index: 2 }, { index: 3 },
  ]);
  store.update("telegram:1", "c1", { screen: "item", cursor: 2 });
  assert.equal(
    resolveNavigationInput("следующая", store.peek("telegram:1", "c1")).action
      ?.index,
    3
  );
  assert.equal(
    resolveNavigationInput("предыдущая", store.peek("telegram:1", "c1")).action
      ?.index,
    1
  );
  assert.equal(
    resolveNavigationInput("список", store.peek("telegram:1", "c1")).action
      ?.type,
    "show_list"
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
