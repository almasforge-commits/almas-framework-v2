/**
 * Regression tests for Capture/Finance business bugs:
 * 1) description numbers must not become extra expenses
 * 2) тысяч / тыс / k / к list parsing
 * 3) confirm persists finance only when write succeeds
 * 4) income with temporal prefix stays income (not idea)
 * 5) idea confirm skips AI reclassification
 * 6) capture session load actor/persist diagnostics
 */

import assert from "node:assert/strict";
import {
  parseFinanceMessage,
  looksLikeFinanceAttempt,
} from "../services/finance/financeParser.js";
import {
  parseFinanceMessages,
} from "../services/finance/financeMultiParser.js";
import { convertSpokenNumbersToDigits } from "../services/finance/russianNumberParser.js";
import {
  buildDeterministicCaptureDraft,
} from "../services/capture/captureDraftBuilder.js";
import { executeCaptureBatch } from "../services/capture/captureBatchExecutor.js";
import { confirmCaptureSessionById } from "../services/capture/captureSessionMutations.js";
import { createCaptureSessionStore } from "../services/capture/captureSessionStore.js";
import { detectIdea } from "../services/ideas/ideaDetector.js";

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

await test("BUG1: Node 22 in description is one expense", () => {
  const single = parseFinanceMessage("Потратил 329000 VND на Node 22 test");
  assert.equal(single.amount, 329000);
  assert.equal(single.description, "Node 22 test");
  assert.equal(parseFinanceMessages("Потратил 329000 VND на Node 22 test").length, 0);
  const draft = buildDeterministicCaptureDraft(
    "Потратил 329000 VND на Node 22 test"
  );
  assert.equal(draft.actions.length, 1);
  assert.equal(draft.actions[0].type, "finance_expense");
  assert.equal(draft.actions[0].payload.amount, 329000);
  assert.equal(draft.actions[0].payload.description, "Node 22 test");
});

await test("BUG1: GPT-4 / iPhone 16 / Version 3.2 stay description", () => {
  for (const text of [
    "Потратил 100 на GPT-4",
    "Потратил 200 на iPhone 16",
    "Потратил 50 на Version 3.2",
    "Потратил 10 на ChatGPT 5",
  ]) {
    assert.equal(parseFinanceMessages(text).length, 0);
    const draft = buildDeterministicCaptureDraft(text);
    assert.equal(draft.actions.length, 1, text);
    assert.equal(draft.actions[0].type, "finance_expense", text);
  }
});

await test("BUG2: тысяч list becomes three expenses not five", () => {
  assert.equal(convertSpokenNumbersToDigits("75 тысяч"), "75000");
  assert.equal(
    convertSpokenNumbersToDigits("75 тысяч, 25 тысяч, 300 тысяч"),
    "75000, 25000, 300000"
  );
  assert.equal(
    convertSpokenNumbersToDigits("75 тысяч 25 тысяч 300 тысяч"),
    "75000 25000 300000"
  );

  const multi = parseFinanceMessages("75 тысяч, 25 тысяч, 300 тысяч");
  assert.deepEqual(
    multi.map((o) => o.amount),
    [75000, 25000, 300000]
  );

  const draft = buildDeterministicCaptureDraft(
    "Потратил 75 тысяч, 25 тысяч и 300 тысяч"
  );
  assert.equal(draft.actions.length, 3);
  assert.deepEqual(
    draft.actions.map((a) => a.payload.amount),
    [75000, 25000, 300000]
  );
});

await test("BUG2: тыс / k / к suffixes", () => {
  assert.equal(parseFinanceMessage("потратил 40 тыс на кофе").amount, 40000);
  assert.equal(parseFinanceMessage("потратил 40к на кофе").amount, 40000);
  assert.equal(parseFinanceMessage("потратил 40k на кофе").amount, 40000);
  assert.equal(parseFinanceMessage("потратил 2 млн на дом").amount, 2000000);
});

await test("BUG4: temporal income stays income, not idea", () => {
  const parsed = parseFinanceMessage(
    "Сегодня заработал 250 долларов за работу"
  );
  assert.ok(parsed);
  assert.equal(parsed.type, "income");
  assert.equal(parsed.amount, 250);
  assert.equal(parsed.currency, "USD");

  assert.equal(
    detectIdea("Сегодня заработал 250 долларов за работу").isIdea,
    false
  );
  assert.equal(
    looksLikeFinanceAttempt("Сегодня заработал 250 долларов за работу"),
    true
  );

  const draft = buildDeterministicCaptureDraft(
    "Сегодня заработал 250 долларов за работу"
  );
  assert.equal(draft.actions.length, 1);
  assert.equal(draft.actions[0].type, "finance_income");
  assert.equal(draft.actions[0].payload.amount, 250);
  assert.ok(!draft.actions.some((a) => a.type === "idea_create"));
});

await test("BUG3: confirm marks finance executed only when write returns row", async () => {
  const session = {
    id: "s1",
    actorKey: "tg:1",
    chatId: 1,
    source: "text",
    draft: {
      actions: [
        {
          type: "finance_expense",
          content: "test",
          payload: { amount: 100, currency: "VND", description: "test" },
        },
      ],
    },
  };

  const failed = await executeCaptureBatch(session, { userId: "1" }, {
    addExpenseFn: async () => null,
  });
  assert.equal(failed.executedCount, 0);
  assert.equal(failed.results[0].reason, "finance_persist_failed");

  const ok = await executeCaptureBatch(session, { userId: "1" }, {
    addExpenseFn: async () => ({ id: "tx1" }),
  });
  assert.equal(ok.executedCount, 1);
  assert.equal(ok.results[0].reason, "ok");
});

await test("BUG3/5: confirmCaptureSessionById fails closed when persist fails", async () => {
  const store = createCaptureSessionStore();
  const session = await store.create({
    actorKey: "tg:9",
    chatId: 9,
    originalText: "идея тест",
    draft: {
      actions: [
        {
          type: "idea_create",
          content: "идея тест длинная для сохранения",
          payload: { content: "идея тест длинная для сохранения" },
        },
      ],
    },
  });

  const result = await confirmCaptureSessionById(
    session.id,
    { actorKey: "tg:9", telegramUserId: 9 },
    {
      store,
      executeFn: async () => ({
        executedCount: 0,
        results: [{ executed: false, reason: "persist_failed" }],
      }),
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "persist_failed");
  // Session must remain pending for retry.
  assert.ok(store.get("tg:9", 9));
});

await test("BUG5: idea confirm skips AI and requires actorKey path", async () => {
  let seen = null;
  const session = {
    id: "s2",
    actorKey: "tg:2",
    chatId: 2,
    source: "text",
    draft: {
      actions: [
        {
          type: "idea_create",
          content: "идея для нового продукта ALMAS",
          payload: { content: "идея для нового продукта ALMAS" },
        },
      ],
    },
  };
  const result = await executeCaptureBatch(
    session,
    { userId: "2", actorKey: "tg:2" },
    {
      captureIdeaFn: async (input) => {
        seen = input;
        return { ok: true, idea: { id: "idea1", ...input } };
      },
    }
  );
  assert.equal(result.executedCount, 1);
  assert.equal(seen.skipAi, true);
  assert.equal(seen.origin, "capture_session");
  assert.equal(seen.actorKey, "tg:2");
});

console.log(`\ncapture-finance-bugs: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
