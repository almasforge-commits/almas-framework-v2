import assert from "node:assert/strict";

import {
  formatAiExecutionConfirmation,
  formatAiExecutionConfirmations,
  sendAiExecutionConfirmations,
} from "../handlers/routes/aiExecutionRoute.js";
import { createAction } from "../services/inbox/contracts.js";

// sendAiExecutionConfirmations always receives an injected sendMessageFn
// here — no real Telegram access. This file also proves the rendering
// boundary: only THIS module (not actionExecutor.js) turns execution
// results into Telegram text.

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

function executed(type, payload) {
  return { action: createAction({ type, confidence: 0.95, payload }), executed: true, reason: "ok" };
}

async function run() {
  await test("formatAiExecutionConfirmation: task_create renders '✅ Задача сохранена' + content", () => {
    const text = formatAiExecutionConfirmation(executed("task_create", { content: "Купить батарейки" }));
    assert.equal(text, "✅ Задача сохранена\n\nКупить батарейки");
  });

  await test("formatAiExecutionConfirmation: memory_save renders exactly '🧠 Запомнил.'", () => {
    const text = formatAiExecutionConfirmation(executed("memory_save", { content: "мне нравится работать ночью" }));
    assert.equal(text, "🧠 Запомнил.");
  });

  await test("formatAiExecutionConfirmation: task_create with no content still renders a confirmation (never invents content)", () => {
    const text = formatAiExecutionConfirmation(executed("task_create", {}));
    assert.equal(text, "✅ Задача сохранена");
  });

  await test("formatAiExecutionConfirmation: unknown/unexpected type returns null (defense in depth)", () => {
    assert.equal(formatAiExecutionConfirmation(executed("finance_expense", { amount: 1 })), null);
    assert.equal(formatAiExecutionConfirmation(null), null);
    assert.equal(formatAiExecutionConfirmation(undefined), null);
  });

  await test("formatAiExecutionConfirmations renders one message per executed action, in order, skipping unrenderable ones", () => {
    const texts = formatAiExecutionConfirmations([
      executed("task_create", { content: "Купить батарейки" }),
      executed("finance_expense", { amount: 1 }),
      executed("memory_save", { content: "note" }),
    ]);
    assert.deepEqual(texts, ["✅ Задача сохранена\n\nКупить батарейки", "🧠 Запомнил."]);
  });

  await test("formatAiExecutionConfirmations handles an empty/undefined list", () => {
    assert.deepEqual(formatAiExecutionConfirmations([]), []);
    assert.deepEqual(formatAiExecutionConfirmations(undefined), []);
  });

  await test("sendAiExecutionConfirmations sends one Telegram message per executed action, to the given chatId", async () => {
    const sendMessageFn = spy();
    const sentCount = await sendAiExecutionConfirmations(
      "chat1",
      [executed("task_create", { content: "Купить батарейки" }), executed("memory_save", { content: "note" })],
      { sendMessageFn }
    );
    assert.equal(sentCount, 2);
    assert.equal(sendMessageFn.calls.length, 2);
    assert.deepEqual(sendMessageFn.calls[0], ["chat1", "✅ Задача сохранена\n\nКупить батарейки"]);
    assert.deepEqual(sendMessageFn.calls[1], ["chat1", "🧠 Запомнил."]);
  });

  await test("sendAiExecutionConfirmations sends nothing for an empty executedActions list", async () => {
    const sendMessageFn = spy();
    const sentCount = await sendAiExecutionConfirmations("chat1", [], { sendMessageFn });
    assert.equal(sentCount, 0);
    assert.equal(sendMessageFn.calls.length, 0);
  });

  await test("sendAiExecutionConfirmations never throws when one send fails, and still tries the remaining ones", async () => {
    let call = 0;
    const sendMessageFn = spy(async () => {
      call += 1;
      if (call === 1) throw new Error("telegram down");
      return true;
    });
    const sentCount = await sendAiExecutionConfirmations(
      "chat1",
      [executed("task_create", { content: "a" }), executed("memory_save", { content: "b" })],
      { sendMessageFn }
    );
    assert.equal(sendMessageFn.calls.length, 2);
    assert.equal(sentCount, 1, "only the second (successful) send should count");
  });

  if (process.exitCode) {
    console.error("\nSome ai-execution-route tests failed.");
  } else {
    console.log("\nAll ai-execution-route tests passed.");
  }
}

run();
