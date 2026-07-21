/**
 * Telegram Ideas/Memory main-menu UX regressions.
 */

import assert from "node:assert/strict";
import { formatIdeaList } from "../services/ideas/ideaFormatters.js";
import {
  formatMemoryMenuSummary,
  prepareMemoryMenuItems,
} from "../services/storage/memoryMenuSummary.js";
import { handleMenuCallback } from "../handlers/callbackHandler.js";
import {
  sendIdeasMenu,
  sendMemoryMenu,
} from "../handlers/routes/menuRoute.js";

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

await test("1. Ideas menu opens thin Mini App teaser", async () => {
  const sendMessageFn = spy();
  await sendIdeasMenu("c1", {
    sendMessageFn,
    actorKey: "telegram:7",
    listIdeasFn: async () => {
      throw new Error("list should not be called for thin menu");
    },
  });
  assert.match(sendMessageFn.calls[0][1], /Ideas/);
  assert.match(sendMessageFn.calls[0][1], /Open ALMAS/);
});

await test("2. Ideas menu is not help-only when ideas exist", async () => {
  const text = formatIdeaList({
    ideas: [{ normalizedText: "Кофейня", category: "business" }],
    total: 1,
    menuStyle: true,
  });
  assert.match(text, /Ваши идеи/);
  assert.ok(!/Просто напишите или скажите мысль/.test(text));
});

await test("3. Empty Ideas list shows empty state", () => {
  const text = formatIdeaList({ ideas: [], total: 0, menuStyle: true });
  assert.match(text, /Пока идей нет/);
  assert.match(text, /У меня идея/);
});

await test("4. Memory menu is thin Mini App teaser", async () => {
  const sendMessageFn = spy();
  await sendMemoryMenu("c1", {
    sendMessageFn,
    userId: "9",
    listMemoriesFn: async () => {
      throw new Error("list should not be called for thin menu");
    },
  });
  const text = sendMessageFn.calls[0][1];
  assert.match(text, /Memory/);
  assert.match(text, /Open ALMAS/);
});

await test("5. Memory menu excludes tasks, finance, navigation", () => {
  const items = prepareMemoryMenuItems([
    { content: "Мне нравится кофе" },
    { content: "Мои задачи" },
    { content: "баланс" },
    { content: "потратил 50000 на обед" },
    { content: "купить молоко" },
    { content: "💡 Идеи" },
  ]);
  assert.equal(items.length, 1);
  assert.match(items[0].content, /кофе/i);
});

await test("6. Memory menu deduplicates repeated memories", () => {
  const items = prepareMemoryMenuItems([
    { content: "Запомни, что мне нравится кофе" },
    { content: "Мне нравится кофе" },
    { content: "мне нравится кофе." },
  ]);
  assert.equal(items.length, 1);
});

await test("7. Memory menu strips Запомни prefix", () => {
  const items = prepareMemoryMenuItems([
    { content: "Запомни, что мне нравится кокосовое молоко" },
  ]);
  assert.equal(items.length, 1);
  assert.ok(!/^Запомни/i.test(items[0].content));
  assert.match(items[0].content, /кокосовое молоко/i);

  const text = formatMemoryMenuSummary({ items });
  assert.ok(!/Запомни, что/i.test(text));
});

await test("8. Ideas menu no longer loads actor lists in Telegram", async () => {
  const sendMessageFn = spy();
  let seen = null;
  await sendIdeasMenu("c1", {
    sendMessageFn,
    actorKey: "telegram:A",
    listIdeasFn: async (actorKey) => {
      seen = actorKey;
      return { ideas: [], total: 0, pageSize: 10 };
    },
  });
  assert.equal(seen, null);
  assert.match(sendMessageFn.calls[0][1], /Ideas/);
});

await test("9. Memory menu no longer loads lists in Telegram", async () => {
  let seen = null;
  const sent = [];
  await sendMemoryMenu("c1", {
    sendMessageFn: async (_c, t) => sent.push(t),
    userId: "111",
    actorKey: "telegram:111",
    listMemoriesFn: async (id) => {
      seen = id;
      return [];
    },
  });
  assert.equal(seen, null);
  assert.match(sent[0], /Memory/);
});

await test("13. text Ideas menu and callback instruction paths work", async () => {
  const sentText = [];
  await sendIdeasMenu("c1", {
    sendMessageFn: async (_c, t) => sentText.push(t),
    actorKey: "telegram:5",
  });
  assert.match(sentText.join("\n"), /Ideas/);
  assert.match(sentText.join("\n"), /Open ALMAS/);

  const sentCb = [];
  await handleMenuCallback(
    {
      id: "q2",
      data: "menu:ideas:new",
      from: { id: 1 },
      message: { chat: { id: 1 } },
    },
    {
      sendMessageFn: async (_c, t) => sentCb.push(t),
      answerCallbackQueryFn: async () => {},
    }
  );
  await handleMenuCallback(
    {
      id: "q3",
      data: "menu:memory:save",
      from: { id: 1 },
      message: { chat: { id: 1 } },
    },
    {
      sendMessageFn: async (_c, t) => sentCb.push(t),
      answerCallbackQueryFn: async () => {},
    }
  );
  assert.ok(sentCb.some((t) => /У меня идея/.test(t)));
  assert.ok(sentCb.some((t) => /Запомни, что/.test(t)));
});

await test("pagination still shows ...ещё N in menu style", () => {
  const ideas = Array.from({ length: 10 }, (_, i) => ({
    normalizedText: `Идея ${i + 1}`,
    category: "other",
  }));
  const text = formatIdeaList({ ideas, total: 15, pageSize: 10, menuStyle: true });
  assert.match(text, /Ваши идеи — 15/);
  assert.match(text, /\.\.\.ещё 5/);
});

console.log(`\nmenu-ideas-memory: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
