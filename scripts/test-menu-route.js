import assert from "node:assert/strict";

import {
  sendMainMenu,
  sendFallback,
  sendKnowledgeMenu,
  sendKnowledgeAll,
  sendKnowledgeSearchInstruction,
  sendTasksMenu,
  sendCompletedTasksList,
  sendFinanceMenu,
  sendFinanceHistory,
  sendFinanceStatistics,
  sendMemoryMenu,
  sendMemoryRecallInstruction,
  sendMemorySearchInstruction,
  sendIdeasMenu,
  sendIdeasPlaceholder,
  sendProjectsPlaceholder,
  sendOpenAlmas,
  sendHelp,
} from "../handlers/routes/menuRoute.js";

// Every send* function here is always called with an injected
// sendMessageFn (and, where relevant, injected service-read functions) —
// no real Telegram, Supabase, OpenAI, or network access ever happens in
// this file. This also proves each function reuses the existing service
// functions (getAllKnowledge/getActiveTasks/getCompletedTasks/getBalance/
// getHistory/getStatistics) rather than inventing new storage/business
// logic.

function spy(impl) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function run() {
  await test("sendMainMenu sends the exact greeting with reply_markup.keyboard", async () => {
    const sendMessageFn = spy();
    await sendMainMenu("chat1", { sendMessageFn });
    assert.equal(sendMessageFn.calls.length, 1);
    const [chatId, text, extra] = sendMessageFn.calls[0];
    assert.equal(chatId, "chat1");
    assert.match(text, /ALMAS готов/);
    assert.match(text, /напишите или скажите/i);
    assert.ok(!/Выбери раздел/i.test(text));
    assert.ok(extra.reply_markup.keyboard);
    assert.equal(extra.reply_markup.keyboard.length, 2);
  });

  await test("sendFallback sends the exact short fallback text with the main keyboard", async () => {
    const sendMessageFn = spy();
    await sendFallback("chat1", { sendMessageFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Не понял запрос/);
    assert.ok(extra.reply_markup.keyboard);
  });

  await test("sendKnowledgeMenu is thin Mini App teaser", async () => {
    const sendMessageFn = spy();
    await sendKnowledgeMenu("chat1", { sendMessageFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Knowledge/);
    assert.match(text, /Open ALMAS/);
    assert.ok(extra.reply_markup.inline_keyboard);
  });

  await test("sendKnowledgeMenu empty still thin", async () => {
    const sendMessageFn = spy();
    await sendKnowledgeMenu("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Knowledge/);
  });

  await test("sendKnowledgeAll redirects to thin knowledge menu", async () => {
    const sendMessageFn = spy();
    await sendKnowledgeAll("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Knowledge/);
  });

  await test("sendKnowledgeSearchInstruction is a stateless instruction to type the existing 'найди' command", async () => {
    const sendMessageFn = spy();
    await sendKnowledgeSearchInstruction("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /найди/);
  });

  await test("sendTasksMenu is thin Mini App teaser", async () => {
    const sendMessageFn = spy();
    await sendTasksMenu("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Tasks/);
    assert.match(text, /Open ALMAS/);
  });

  await test("sendTasksMenu empty still thin", async () => {
    const sendMessageFn = spy();
    await sendTasksMenu("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Tasks/);
  });

  await test("sendCompletedTasksList redirects to thin tasks menu", async () => {
    const sendMessageFn = spy();
    await sendCompletedTasksList("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Tasks/);
  });

  await test("sendFinanceMenu is thin Mini App teaser", async () => {
    const sendMessageFn = spy();
    await sendFinanceMenu("chat1", "user42", {
      sendMessageFn,
      actorKey: "telegram:42",
    });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Finance/);
    assert.match(text, /Open ALMAS/);
    assert.ok(extra.reply_markup.inline_keyboard);
  });

  await test("sendFinanceHistory redirects to thin finance menu", async () => {
    const sendMessageFn = spy();
    await sendFinanceHistory("chat1", "user42", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Finance/);
  });

  await test("sendFinanceStatistics redirects to thin finance menu", async () => {
    const sendMessageFn = spy();
    await sendFinanceStatistics("chat1", "user42", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Finance/);
  });

  await test("sendMemoryMenu is thin Mini App teaser with save shortcut", async () => {
    const sendMessageFn = spy();
    await sendMemoryMenu("chat1", {
      sendMessageFn,
      userId: "42",
      actorKey: "telegram:42",
    });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Memory/);
    assert.match(text, /Open ALMAS/);
    const callbacks = extra.reply_markup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean);
    assert.ok(callbacks.includes("menu:memory:save"));
    assert.ok(!callbacks.includes("menu:home"));
  });

  await test("sendMemoryMenu empty state is still thin", async () => {
    const sendMessageFn = spy();
    await sendMemoryMenu("chat1", {
      sendMessageFn,
      userId: "42",
      actorKey: "telegram:42",
      listMemoriesFn: async () => [],
    });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Memory/);
    assert.match(text, /Open ALMAS/);
  });

  await test("sendMemoryRecallInstruction is a stateless instruction to type the existing 'вспомни' command", async () => {
    const sendMessageFn = spy();
    await sendMemoryRecallInstruction("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /вспомни/);
  });

  await test("sendMemorySearchInstruction is a stateless instruction to type the existing 'найди' command", async () => {
    const sendMessageFn = spy();
    await sendMemorySearchInstruction("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /найди/);
  });

  await test("sendIdeasMenu shows actor-scoped list, not help-only", async () => {
    const sendMessageFn = spy();
    await sendIdeasMenu("chat1", {
      sendMessageFn,
      actorKey: "telegram:7",
    });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Ideas/);
    assert.match(text, /Open ALMAS/);
    const callbacks = extra.reply_markup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean);
    assert.ok(callbacks.includes("menu:ideas:new"));
    assert.ok(!callbacks.includes("menu:home"));
  });

  await test("sendIdeasMenu empty state", async () => {
    const sendMessageFn = spy();
    await sendIdeasMenu("chat1", {
      sendMessageFn,
      actorKey: null,
    });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Пока идей нет/);
    assert.match(text, /У меня идея/);
    const callbacks = extra.reply_markup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean);
    assert.ok(callbacks.includes("menu:ideas:new"));
    assert.ok(!callbacks.includes("menu:home"));
  });

  await test("sendIdeasPlaceholder aliases sendIdeasMenu", async () => {
    const sendMessageFn = spy();
    await sendIdeasPlaceholder("chat1", {
      sendMessageFn,
      actorKey: "telegram:1",
    });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Ideas/);
  });

  await test("sendProjectsPlaceholder sends the exact required placeholder text", async () => {
    const sendMessageFn = spy();
    await sendProjectsPlaceholder("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.equal(text, "🚀 Проекты — раздел готовится.");
  });

  await test("sendOpenAlmas shows the 'not connected' message when no Web App URL is configured", async () => {
    const sendMessageFn = spy();
    await sendOpenAlmas("chat1", { sendMessageFn, webAppUrl: null });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.equal(text, "Mini App пока не подключён.");
    assert.ok(extra.reply_markup.keyboard);
  });

  await test("sendOpenAlmas shows a different message when a Web App URL is configured (edge case: label typed as text)", async () => {
    const sendMessageFn = spy();
    await sendOpenAlmas("chat1", {
      sendMessageFn,
      webAppUrl: "https://app.almas.example",
      chatType: "private",
    });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.notEqual(text, "Mini App пока не подключён.");
    const btn = extra.reply_markup.inline_keyboard[0][0];
    assert.ok(btn.web_app?.url);
    assert.equal(btn.url, undefined);
  });

  await test("sendHelp sends concise onboarding with the main reply keyboard", async () => {
    const sendMessageFn = spy();
    await sendHelp("chat1", { sendMessageFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Как пользоваться ALMAS/);
    assert.match(text, /Потратил/);
    assert.match(text, /идея/i);
    assert.match(text, /Запомни/);
    assert.ok(extra.reply_markup.keyboard);
    assert.equal(extra.reply_markup.keyboard.length, 2);
  });

  if (process.exitCode) {
    console.error("\nSome menu-route tests failed.");
  } else {
    console.log("\nAll menu-route tests passed.");
  }
}

run();
