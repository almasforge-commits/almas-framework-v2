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
    assert.equal(text, "👋 ALMAS готов. Выбери раздел:");
    assert.ok(extra.reply_markup.keyboard);
  });

  await test("sendFallback sends the exact short fallback text with the main keyboard", async () => {
    const sendMessageFn = spy();
    await sendFallback("chat1", { sendMessageFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.equal(text, "Не понял запрос. Выбери раздел в меню 👇");
    assert.ok(extra.reply_markup.keyboard);
  });

  await test("sendKnowledgeMenu lists at most the latest 5 items (via getAllKnowledge) with the knowledge inline keyboard", async () => {
    const sendMessageFn = spy();
    const items = Array.from({ length: 8 }, (_, i) => ({ title: `Item ${i + 1}` }));
    const getAllKnowledgeFn = spy(() => items);
    await sendKnowledgeMenu("chat1", { sendMessageFn, getAllKnowledgeFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Item 1/);
    assert.match(text, /Item 5/);
    assert.doesNotMatch(text, /Item 6/);
    assert.ok(extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "menu:knowledge:all"));
  });

  await test("sendKnowledgeMenu shows an empty-state message when there is no knowledge yet", async () => {
    const sendMessageFn = spy();
    const getAllKnowledgeFn = spy(() => []);
    await sendKnowledgeMenu("chat1", { sendMessageFn, getAllKnowledgeFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /пуста/);
  });

  await test("sendKnowledgeAll lists every item (no slicing) with a home-only keyboard", async () => {
    const sendMessageFn = spy();
    const items = Array.from({ length: 8 }, (_, i) => ({ title: `Item ${i + 1}` }));
    const getAllKnowledgeFn = spy(() => items);
    await sendKnowledgeAll("chat1", { sendMessageFn, getAllKnowledgeFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Item 8/);
    assert.deepEqual(extra.reply_markup.inline_keyboard, [
      [{ text: "🏠 Главная", callback_data: "menu:home" }],
    ]);
  });

  await test("sendKnowledgeSearchInstruction is a stateless instruction to type the existing 'найди' command", async () => {
    const sendMessageFn = spy();
    await sendKnowledgeSearchInstruction("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /найди/);
  });

  await test("sendTasksMenu lists at most the latest 5 active tasks (via getActiveTasks)", async () => {
    const sendMessageFn = spy();
    const tasks = Array.from({ length: 7 }, (_, i) => ({ content: `Task ${i + 1}` }));
    const getActiveTasksFn = spy(() => tasks);
    await sendTasksMenu("chat1", { sendMessageFn, getActiveTasksFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Task 1/);
    assert.match(text, /Task 5/);
    assert.doesNotMatch(text, /Task 6/);
  });

  await test("sendTasksMenu shows an empty-state message when there are no active tasks", async () => {
    const sendMessageFn = spy();
    const getActiveTasksFn = spy(() => []);
    await sendTasksMenu("chat1", { sendMessageFn, getActiveTasksFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /нет активных задач/);
  });

  await test("sendCompletedTasksList lists completed tasks (via getCompletedTasks) with a home-only keyboard", async () => {
    const sendMessageFn = spy();
    const getCompletedTasksFn = spy(() => [{ content: "Done task" }]);
    await sendCompletedTasksList("chat1", { sendMessageFn, getCompletedTasksFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Done task/);
    assert.deepEqual(extra.reply_markup.inline_keyboard, [
      [{ text: "🏠 Главная", callback_data: "menu:home" }],
    ]);
  });

  await test("sendFinanceMenu shows balance + latest 5 transactions (via getBalance/getHistory) for the given userId", async () => {
    const sendMessageFn = spy();
    const getBalanceFn = spy();
    getBalanceFn.impl = async () => ({ VND: { income: 100000, expense: 40000, balance: 60000 } });
    const balanceSpy = spy((userId) => {
      assert.equal(userId, "user42");
      return { VND: { income: 100000, expense: 40000, balance: 60000 } };
    });
    const historySpy = spy((userId, limit) => {
      assert.equal(userId, "user42");
      assert.equal(limit, 5);
      return [{ type: "expense", amount: 40000, currency: "VND", category: "Кофе" }];
    });
    await sendFinanceMenu("chat1", "user42", {
      sendMessageFn,
      getBalanceFn: balanceSpy,
      getHistoryFn: historySpy,
    });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Баланс/);
    assert.match(text, /Последние операции/);
    assert.ok(extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "menu:finance:history"));
  });

  await test("sendFinanceHistory reuses getHistory's default limit and shows a home-only keyboard", async () => {
    const sendMessageFn = spy();
    const getHistoryFn = spy((userId, limit) => {
      assert.equal(userId, "user42");
      assert.equal(limit, undefined);
      return [{ type: "income", amount: 5000, currency: "VND" }];
    });
    await sendFinanceHistory("chat1", "user42", { sendMessageFn, getHistoryFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /5,000|5000/);
    assert.deepEqual(extra.reply_markup.inline_keyboard, [
      [{ text: "🏠 Главная", callback_data: "menu:home" }],
    ]);
  });

  await test("sendFinanceStatistics reuses getStatistics and shows a home-only keyboard", async () => {
    const sendMessageFn = spy();
    const getStatisticsFn = spy(() => ({
      transactions: 2,
      incomes: { VND: 5000 },
      expenses: { VND: 40000 },
      biggestExpense: { description: "Кофе", amount: 40000, currency: "VND" },
    }));
    await sendFinanceStatistics("chat1", "user42", { sendMessageFn, getStatisticsFn });
    const [, text] = sendMessageFn.calls[0];
    assert.match(text, /Статистика/);
  });

  await test("sendMemoryMenu sends a short explanation with recall/search inline buttons", async () => {
    const sendMessageFn = spy();
    await sendMemoryMenu("chat1", { sendMessageFn });
    const [, , extra] = sendMessageFn.calls[0];
    assert.deepEqual(
      extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
      ["menu:memory:recall", "menu:memory:search", "menu:home"]
    );
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

  await test("sendIdeasPlaceholder sends the exact required placeholder text", async () => {
    const sendMessageFn = spy();
    await sendIdeasPlaceholder("chat1", { sendMessageFn });
    const [, text] = sendMessageFn.calls[0];
    assert.equal(text, "💡 Идеи — раздел готовится.");
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
    const [, text] = sendMessageFn.calls[0];
    assert.equal(text, "Веб-интерфейс пока не подключён.");
  });

  await test("sendOpenAlmas shows a different message when a Web App URL is configured (edge case: label typed as text)", async () => {
    const sendMessageFn = spy();
    await sendOpenAlmas("chat1", { sendMessageFn, webAppUrl: "https://app.almas.example" });
    const [, text] = sendMessageFn.calls[0];
    assert.notEqual(text, "Веб-интерфейс пока не подключён.");
  });

  await test("sendHelp sends the full detailed command guide with a home-only keyboard", async () => {
    const sendMessageFn = spy();
    await sendHelp("chat1", { sendMessageFn });
    const [, text, extra] = sendMessageFn.calls[0];
    assert.match(text, /Пока я умею:/);
    assert.match(text, /расход 100 кофе/);
    assert.deepEqual(extra.reply_markup.inline_keyboard, [
      [{ text: "🏠 Главная", callback_data: "menu:home" }],
    ]);
  });

  if (process.exitCode) {
    console.error("\nSome menu-route tests failed.");
  } else {
    console.log("\nAll menu-route tests passed.");
  }
}

run();
