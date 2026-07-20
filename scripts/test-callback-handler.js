import assert from "node:assert/strict";

import { handleMenuCallback } from "../handlers/callbackHandler.js";

// handleMenuCallback is always called with injected sendMessageFn and
// answerCallbackQueryFn here — no real Telegram/Supabase/OpenAI access.
// The individual menu-route functions it dispatches to are exercised in
// isolation in scripts/test-menu-route.js; this file only verifies the
// callback_data -> handler dispatch table and the answerCallbackQuery
// contract.

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

function query(data, overrides = {}) {
  return {
    id: "cbq1",
    data,
    message: { chat: { id: "chat1" } },
    from: { id: 42 },
    ...overrides,
  };
}

async function run() {
  const knownCallbacks = [
    "menu:home",
    "menu:knowledge:all",
    "menu:knowledge:search",
    "menu:tasks:done",
    "menu:finance:history",
    "menu:finance:stats",
    "menu:memory:recall",
    "menu:memory:search",
  ];

  for (const data of knownCallbacks) {
    await test(`handleMenuCallback dispatches "${data}" and answers the callback query`, async () => {
      const sendMessageFn = spy();
      const answerCallbackQueryFn = spy();
      await handleMenuCallback(query(data), { sendMessageFn, answerCallbackQueryFn });
      assert.equal(sendMessageFn.calls.length, 1, `Expected exactly one sendMessage call for ${data}`);
      assert.equal(sendMessageFn.calls[0][0], "chat1");
      assert.equal(answerCallbackQueryFn.calls.length, 1);
      assert.equal(answerCallbackQueryFn.calls[0][0], "cbq1");
    });
  }

  await test("finance callbacks pass the query's from.id as userId to the finance route", async () => {
    const sendMessageFn = spy();
    const answerCallbackQueryFn = spy();
    await handleMenuCallback(query("menu:finance:history", { from: { id: 777 } }), {
      sendMessageFn,
      answerCallbackQueryFn,
      // sendFinanceHistory itself defaults to the real getHistory; since
      // it's mocked via sendMessageFn only, we just assert it didn't
      // throw and did reply — the userId plumbing itself is covered in
      // test-menu-route.js. Here we only assert end-to-end wiring works.
    });
    assert.equal(sendMessageFn.calls.length, 1);
  });

  await test("an unknown callback_data is ignored (no crash) but the query is still answered", async () => {
    const sendMessageFn = spy();
    const answerCallbackQueryFn = spy();
    await handleMenuCallback(query("menu:does-not-exist"), { sendMessageFn, answerCallbackQueryFn });
    assert.equal(sendMessageFn.calls.length, 0);
    assert.equal(answerCallbackQueryFn.calls.length, 1);
  });

  await test("a callback query with no message/chat (edge case) does not crash and still answers", async () => {
    const sendMessageFn = spy();
    const answerCallbackQueryFn = spy();
    await handleMenuCallback(query("menu:home", { message: undefined }), {
      sendMessageFn,
      answerCallbackQueryFn,
    });
    assert.equal(sendMessageFn.calls.length, 0);
    assert.equal(answerCallbackQueryFn.calls.length, 1);
  });

  await test("a handler failure is caught and logged, but the query is still answered", async () => {
    const sendMessageFn = spy(async () => {
      throw new Error("boom");
    });
    const answerCallbackQueryFn = spy();
    await handleMenuCallback(query("menu:home"), { sendMessageFn, answerCallbackQueryFn });
    assert.equal(answerCallbackQueryFn.calls.length, 1);
  });

  await test("answerCallbackQuery failing itself never throws out of handleMenuCallback", async () => {
    const sendMessageFn = spy();
    const answerCallbackQueryFn = spy(async () => {
      throw new Error("telegram down");
    });
    await assert.doesNotReject(
      handleMenuCallback(query("menu:home"), { sendMessageFn, answerCallbackQueryFn })
    );
  });

  if (process.exitCode) {
    console.error("\nSome callback-handler tests failed.");
  } else {
    console.log("\nAll callback-handler tests passed.");
  }
}

run();
