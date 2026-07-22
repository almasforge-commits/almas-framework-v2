/**
 * Capture dedupe + Russian grouped/spoken amounts + confirm validation.
 */

import assert from "node:assert/strict";
import {
  parseFinanceMessage,
  looksLikeFinanceAttempt,
} from "../services/finance/financeParser.js";
import { parseFinanceMessages } from "../services/finance/financeMultiParser.js";
import { normalizeGroupedDigits } from "../services/finance/financeTextNormalize.js";
import { convertSpokenNumbersToDigits } from "../services/finance/russianNumberParser.js";
import {
  buildDeterministicCaptureDraft,
  buildCaptureDraft,
} from "../services/capture/captureDraftBuilder.js";
import {
  listCaptureFinanceValidationErrors,
  validateCaptureDraft,
} from "../services/capture/validateCaptureDraft.js";
import { createCaptureDraft, createCaptureAction } from "../services/capture/captureContracts.js";
import { executeCaptureBatch } from "../services/capture/captureBatchExecutor.js";
import { confirmCaptureSessionById } from "../services/capture/captureSessionMutations.js";
import { createCaptureSessionStore } from "../services/capture/captureSessionStore.js";
import { classifyInformationKinds } from "../services/inbox/informationKindClassifier.js";
import { resolveActivityDomain } from "../api/mappers/activityDomain.js";

const TRANSCRIPT =
  "Запиши, что я потратил сегодня 75 000 донгов на кофе, потом 25 000 на колу и 300 000 на такси до аэропорта.";

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

await test("1-5: exact RU transcript → 3 expenses VND", () => {
  assert.equal(normalizeGroupedDigits("75 000"), "75000");
  const multi = parseFinanceMessages(TRANSCRIPT);
  assert.equal(multi.length, 3);
  assert.deepEqual(
    multi.map((o) => o.amount),
    [75000, 25000, 300000]
  );
  assert.ok(multi.every((o) => o.currency === "VND"));
  assert.deepEqual(
    multi.map((o) => o.description),
    ["кофе", "кола", "такси до аэропорта"]
  );
  assert.ok(!multi.some((o) => [75, 25, 0].includes(o.amount)));

  const draft = buildDeterministicCaptureDraft(TRANSCRIPT);
  assert.equal(draft.actions.length, 3);
  assert.ok(draft.actions.every((a) => a.type === "finance_expense"));
});

await test("6: AI merge does not duplicate finance", async () => {
  const draft = await buildCaptureDraft(TRANSCRIPT, {
    useUniversalExtraction: true,
    extractUniversalFn: async () => ({
      tier: "ai",
      language: "ru",
      items: [
        {
          kind: "finance",
          content: "кофе",
          confidence: 0.8,
          entities: {
            direction: "expense",
            amount: 75000,
            currency: "VND",
            description: "кофе",
          },
        },
        {
          kind: "finance",
          content: "finance_expense",
          confidence: 0.5,
          entities: {
            direction: "expense",
            amount: 75,
            currency: "VND",
            description: "finance_expense",
          },
        },
        {
          kind: "finance",
          content: "кола",
          confidence: 0.8,
          entities: {
            direction: "expense",
            amount: 25000,
            currency: "VND",
            description: "кола",
          },
        },
        {
          kind: "finance",
          content: "такси",
          confidence: 0.8,
          entities: {
            direction: "expense",
            amount: 300000,
            currency: "VND",
            description: "такси до аэропорта",
          },
        },
      ],
    }),
  });
  const finance = draft.actions.filter((a) =>
    a.type.startsWith("finance_")
  );
  assert.equal(finance.length, 3);
  assert.ok(!finance.some((a) => Number(a.payload.amount) === 75));
});

await test("7: grouped digits consumed once", () => {
  assert.equal(convertSpokenNumbersToDigits("75 000"), "75000");
  assert.equal(parseFinanceMessages("потратил 75 000 на кофе").length, 0);
  assert.equal(parseFinanceMessage("потратил 75 000 на кофе").amount, 75000);
});

await test("8-9: Node 22 / GPT-4 stay single", () => {
  for (const text of [
    "Потратил 329000 VND на Node 22 test",
    "Потратил 100 на GPT-4 subscription",
  ]) {
    assert.equal(parseFinanceMessages(text).length, 0);
    const draft = buildDeterministicCaptureDraft(text);
    assert.equal(draft.actions.length, 1, text);
  }
});

await test("10: invalid finance blocks confirm errors", () => {
  const errors = listCaptureFinanceValidationErrors([
    createCaptureAction({
      type: "finance_expense",
      content: "finance_expense",
      payload: { amount: 0, currency: "VND", description: "finance_expense" },
    }),
  ]);
  assert.ok(errors.length >= 2);
});

await test("11-12: confirm writes exactly 3 rows; repeat idempotent", async () => {
  const store = createCaptureSessionStore({ ttlMs: 60_000 });
  const draft = buildDeterministicCaptureDraft(TRANSCRIPT);
  const session = await store.create({
    actorKey: "tg:1",
    chatId: 1,
    userId: "1",
    source: "voice",
    originalText: TRANSCRIPT,
    draft,
  });

  const writes = [];
  const executeFn = async (sess, ctx, deps) =>
    executeCaptureBatch(sess, ctx, {
      ...deps,
      addExpenseFn: async (row) => {
        writes.push(row);
        return { id: `e${writes.length}` };
      },
      addIncomeFn: async () => null,
      captureIdeaFn: async () => ({ ok: false }),
      saveMemoryFn: async () => false,
    });

  const first = await confirmCaptureSessionById(
    session.id,
    { actorKey: "tg:1", telegramUserId: "1" },
    { store, executeFn }
  );
  assert.equal(first.ok, true);
  assert.equal(first.executedCount, 3);
  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map((w) => w.amount),
    [75000, 25000, 300000]
  );

  const second = await confirmCaptureSessionById(
    session.id,
    { actorKey: "tg:1", telegramUserId: "1" },
    { store, executeFn }
  );
  assert.equal(second.ok, true);
  assert.equal(second.reason, "already_executed");
  assert.equal(writes.length, 3);
});

await test("13-15: Recent Activity finance domain not idea", () => {
  assert.equal(looksLikeFinanceAttempt(TRANSCRIPT), true);
  const kinds = classifyInformationKinds({
    normalizedText: TRANSCRIPT,
    routingDecision: {
      actions: [
        { type: "finance_expense" },
        { type: "finance_expense" },
        { type: "finance_expense" },
      ],
    },
  });
  assert.ok(kinds.informationKinds.includes("finance"));
  assert.ok(!kinds.informationKinds.includes("idea"));

  assert.equal(
    resolveActivityDomain(["finance", "idea"], {
      executionSummary: { actions: ["expense_saved"] },
    }),
    "expense"
  );
  assert.equal(
    resolveActivityDomain(["idea"], {
      executionSummary: { summary: "income_saved" },
    }),
    "income"
  );
  assert.equal(
    resolveActivityDomain(["finance", "idea", "task"], {}),
    "expense"
  );
});

await test("validateCaptureDraft collapses fragment duplicates", () => {
  const raw = createCaptureDraft({
    actions: [
      createCaptureAction({
        type: "finance_expense",
        content: "что я сегодня",
        payload: { amount: 75, currency: "VND", description: "что я сегодня" },
      }),
      createCaptureAction({
        type: "finance_expense",
        content: "кофе",
        payload: { amount: 75000, currency: "VND", description: "кофе" },
      }),
      createCaptureAction({
        type: "finance_expense",
        content: "finance_expense",
        payload: { amount: 0, currency: "VND", description: "finance_expense" },
      }),
    ],
  });
  const result = validateCaptureDraft(raw);
  assert.equal(result.after, 1);
  assert.equal(result.draft.actions[0].payload.amount, 75000);
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed ? 1 : 0);
