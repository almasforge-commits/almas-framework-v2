/**
 * Unified Capture Session + Batch Confirmation tests.
 */

import assert from "node:assert/strict";
import {
  createCaptureSession,
  createCaptureDraft,
  createCaptureAction,
  isCaptureSessionActive,
  parseCaptureControlText,
  CAPTURE_CALLBACK,
  CAPTURE_SESSION_TTL_MS,
} from "../services/capture/captureContracts.js";
import { createCaptureSessionStore } from "../services/capture/captureSessionStore.js";
import {
  buildDeterministicCaptureDraft,
  mapExtractionItemToCaptureAction,
} from "../services/capture/captureDraftBuilder.js";
import { shouldCreateCaptureSession, isExplicitReadOrNavCommand } from "../services/capture/captureEligibility.js";
import { formatCapturePreview } from "../services/capture/capturePreview.js";
import { executeCaptureBatch } from "../services/capture/captureBatchExecutor.js";
import {
  handleCaptureSessionTurn,
  maybeStartCaptureSession,
} from "../services/capture/captureSessionService.js";
import { splitSemanticSegments } from "../services/capture/captureTranscript.js";
import { buildCaptureConfirmKeyboard } from "../handlers/keyboards/captureKeyboard.js";

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

const MIXED = `Сегодня потратил 80 тысяч на кофе,
300 тысяч на продукты,
получил 5 миллионов,
есть идея снять ролик про кофе,
завтра позвонить Арману,
и запомни что мне нравится работать ночью.`;

await test("1. single expense entity in draft", () => {
  const draft = buildDeterministicCaptureDraft("потратил 10000 на кофе");
  assert.equal(draft.actions.length, 1);
  assert.equal(draft.actions[0].type, "finance_expense");
  assert.equal(draft.actions[0].payload.amount, 10000);
});

await test("2. mixed entities produce multi-action draft", () => {
  const draft = buildDeterministicCaptureDraft(MIXED);
  const types = draft.actions.map((a) => a.type);
  assert.ok(types.includes("finance_expense"));
  assert.ok(types.includes("finance_income"));
  assert.ok(types.includes("idea_create"));
  assert.ok(types.includes("task_create"));
  assert.ok(types.includes("preference") || types.includes("memory_save"));
  assert.ok(draft.actions.length >= 5);
});

await test("3. multiple expenses", () => {
  const draft = buildDeterministicCaptureDraft(MIXED);
  const expenses = draft.actions.filter((a) => a.type === "finance_expense");
  assert.ok(expenses.length >= 2);
  assert.ok(expenses.some((e) => e.payload.amount === 80000));
  assert.ok(expenses.some((e) => e.payload.amount === 300000));
});

await test("4. eligibility: mixed → capture; bare command → skip", () => {
  const draft = buildDeterministicCaptureDraft(MIXED);
  assert.equal(shouldCreateCaptureSession(MIXED, draft), true);
  assert.equal(isExplicitReadOrNavCommand("баланс"), true);
  assert.equal(
    shouldCreateCaptureSession("баланс", createCaptureDraft({ actions: [] })),
    false
  );
  assert.equal(isExplicitReadOrNavCommand("открой знание 4"), true);
  assert.equal(isExplicitReadOrNavCommand("4"), true);
});

await test("5. preview is counts-only (no long cards)", () => {
  const draft = buildDeterministicCaptureDraft(MIXED);
  const preview = formatCapturePreview({ draft });
  assert.match(preview, /Captured/);
  assert.match(preview, /Expenses/);
  assert.match(preview, /Income/);
  assert.match(preview, /Idea/);
  assert.match(preview, /Task/);
  assert.match(preview, /Memory/);
  assert.match(preview, /Review →/);
  assert.ok(!/Я разобрал сообщение/.test(preview));
});

await test("6. confirm keyboard callbacks", () => {
  const { reply_markup } = buildCaptureConfirmKeyboard();
  const data = reply_markup.inline_keyboard
    .flat()
    .map((b) => b.callback_data)
    .filter(Boolean)
    .sort();
  assert.deepEqual(data, [
    CAPTURE_CALLBACK.cancel,
    CAPTURE_CALLBACK.confirm,
  ].sort());
});

await test("7. cancel clears session without writes", async () => {
  const store = createCaptureSessionStore();
  const writes = [];
  const started = await maybeStartCaptureSession(
    {
      text: MIXED,
      actorKey: "telegram:1",
      chatId: "c1",
      inputSource: "text",
    },
    { store }
  );
  assert.equal(started.handled, true);
  assert.ok(store.get("telegram:1", "c1"));

  const cancelled = await handleCaptureSessionTurn(
    {
      text: "отмена",
      actorKey: "telegram:1",
      chatId: "c1",
    },
    {
      store,
      executeFn: async () => {
        writes.push("executed");
        return { executedCount: 1, skippedCount: 0 };
      },
    }
  );
  assert.equal(cancelled.reason, "cancelled");
  assert.equal(writes.length, 0);
  assert.equal(store.get("telegram:1", "c1"), null);
});

await test("8. confirm executes batch once (idempotent)", async () => {
  const store = createCaptureSessionStore();
  await maybeStartCaptureSession(
    { text: MIXED, actorKey: "telegram:1", chatId: "c1" },
    { store }
  );

  const calls = [];
  const executorDeps = {
    addExpenseFn: async (row) => {
      calls.push(["expense", row.amount]);
      return true;
    },
    addIncomeFn: async (row) => {
      calls.push(["income", row.amount]);
      return true;
    },
    captureIdeaFn: async () => {
      calls.push(["idea"]);
      return { ok: true, idea: { id: "i1" } };
    },
    saveMemoryFn: async () => {
      calls.push(["memory"]);
      return true;
    },
    classifyMemoryFn: () => ({ memoryType: "note" }),
    skipIdeaAi: true,
  };

  const first = await handleCaptureSessionTurn(
    {
      callbackData: CAPTURE_CALLBACK.confirm,
      actorKey: "telegram:1",
      chatId: "c1",
      from: { id: 1 },
    },
    { store, executorDeps }
  );
  assert.equal(first.reason, "confirmed");
  assert.ok(first.execution.executedCount >= 4);
  const countAfterFirst = calls.length;

  // Re-create and confirm again should work for new session;
  // same session id marked executed — already cleared.
  assert.equal(store.get("telegram:1", "c1"), null);

  await maybeStartCaptureSession(
    { text: MIXED, actorKey: "telegram:1", chatId: "c1" },
    { store }
  );
  const session = store.get("telegram:1", "c1");
  store.markExecuted(session.id);
  const dup = await handleCaptureSessionTurn(
    {
      callbackData: CAPTURE_CALLBACK.confirm,
      actorKey: "telegram:1",
      chatId: "c1",
      from: { id: 1 },
    },
    { store, executorDeps }
  );
  assert.equal(dup.reason, "already_executed");
  assert.equal(calls.length, countAfterFirst);
});

await test("9. TTL expiry clears active session", async () => {
  let now = 1_000_000;
  const store = createCaptureSessionStore({ nowFn: () => now, ttlMs: 1000 });
  await store.create({
    actorKey: "telegram:1",
    chatId: "c1",
    originalText: MIXED,
    draft: buildDeterministicCaptureDraft(MIXED),
  });
  assert.ok(store.get("telegram:1", "c1"));
  now += 1001;
  assert.equal(store.get("telegram:1", "c1"), null);
  assert.ok(CAPTURE_SESSION_TTL_MS >= 10 * 60 * 1000);
});

await test("10. actor A session invisible to actor B", async () => {
  const store = createCaptureSessionStore();
  await store.create({
    actorKey: "telegram:A",
    chatId: "c1",
    originalText: MIXED,
    draft: buildDeterministicCaptureDraft(MIXED),
  });
  assert.ok(store.get("telegram:A", "c1"));
  assert.equal(store.get("telegram:B", "c1"), null);
});

await test("11. chat A session invisible to chat B", async () => {
  const store = createCaptureSessionStore();
  await store.create({
    actorKey: "telegram:1",
    chatId: "chatA",
    originalText: MIXED,
    draft: buildDeterministicCaptureDraft(MIXED),
  });
  assert.ok(store.get("telegram:1", "chatA"));
  assert.equal(store.get("telegram:1", "chatB"), null);
});

await test("12. edit flow rebuilds draft", async () => {
  const store = createCaptureSessionStore();
  await maybeStartCaptureSession(
    { text: MIXED, actorKey: "telegram:1", chatId: "c1" },
    { store }
  );
  const edit = await handleCaptureSessionTurn(
    { text: "исправить", actorKey: "telegram:1", chatId: "c1" },
    { store }
  );
  assert.equal(edit.reason, "awaiting_edit");
  assert.equal(store.get("telegram:1", "c1").status, "editing");

  const rebuilt = await handleCaptureSessionTurn(
    {
      text: "потратил 1000 на чай и запомни что люблю чай",
      actorKey: "telegram:1",
      chatId: "c1",
    },
    { store }
  );
  assert.equal(rebuilt.reason, "edited");
  assert.match(rebuilt.preview, /Captured/);
  assert.match(rebuilt.preview, /Expenses/);
  assert.match(store.get("telegram:1", "c1").originalText, /чай/i);
  assert.equal(store.get("telegram:1", "c1").status, "pending");
});

await test("13. voice eligibility with single entity", () => {
  const draft = buildDeterministicCaptureDraft("потратил 20000 на такси");
  assert.equal(
    shouldCreateCaptureSession("потратил 20000 на такси", draft, {
      inputSource: "voice",
    }),
    true
  );
});

await test("14. long transcript splits into segments", () => {
  const segs = splitSemanticSegments(MIXED);
  assert.ok(segs.length >= 4);
  assert.ok(segs.join(" ").includes("кофе"));
});

await test("15. batch executor uses shared batch_id for finance", async () => {
  const draft = buildDeterministicCaptureDraft(MIXED);
  const session = createCaptureSession({
    actorKey: "telegram:1",
    chatId: 1,
    originalText: MIXED,
    draft,
  });
  const batchIds = new Set();
  await executeCaptureBatch(
    session,
    { userId: "1" },
    {
      addExpenseFn: async (row) => {
        batchIds.add(row.batch_id);
        return true;
      },
      addIncomeFn: async (row) => {
        batchIds.add(row.batch_id);
        return true;
      },
      captureIdeaFn: async () => ({ ok: true, idea: {} }),
      saveMemoryFn: async () => true,
      classifyMemoryFn: () => ({}),
      skipIdeaAi: true,
    }
  );
  assert.equal(batchIds.size, 1);
});

await test("16. mapExtractionItemToCaptureAction finance/idea", () => {
  const expense = mapExtractionItemToCaptureAction({
    kind: "finance",
    content: "кофе",
    confidence: 0.9,
    entities: { direction: "expense", amount: 80, currency: "VND" },
  });
  assert.equal(expense.type, "finance_expense");
  const idea = mapExtractionItemToCaptureAction({
    kind: "idea",
    content: "кофейня",
    confidence: 0.8,
    entities: { summary: "кофейня" },
  });
  assert.equal(idea.type, "idea_create");
});

await test("17. parseCaptureControlText", () => {
  assert.equal(parseCaptureControlText("✅ Сохранить всё"), "confirm");
  assert.equal(parseCaptureControlText("Отмена"), "cancel");
  assert.equal(parseCaptureControlText("исправить"), "edit");
  assert.equal(parseCaptureControlText("hello"), null);
});

await test("18. no capture for short single text expense (compat)", () => {
  const draft = buildDeterministicCaptureDraft("потратил 5000 кофе");
  assert.equal(
    shouldCreateCaptureSession("потратил 5000 кофе", draft, {
      inputSource: "text",
    }),
    false
  );
});

await test("19. isCaptureSessionActive respects status/expiry", () => {
  const now = Date.now();
  const active = createCaptureSession({
    actorKey: "a",
    chatId: 1,
    originalText: "x",
    draft: createCaptureDraft({ actions: [] }),
    nowMs: now,
  });
  assert.equal(isCaptureSessionActive(active, now), true);
  assert.equal(isCaptureSessionActive({ ...active, status: "confirmed" }, now), false);
  assert.equal(
    isCaptureSessionActive({ ...active, expiresAt: now - 1 }, now),
    false
  );
});

await test("20. task + finance + memory together", () => {
  const text =
    "потратил 40000 на кофе, завтра купить батарейки, запомни что люблю эспрессо";
  const draft = buildDeterministicCaptureDraft(text);
  const types = new Set(draft.actions.map((a) => a.type));
  assert.ok(types.has("finance_expense"));
  assert.ok(types.has("task_create") || types.has("reminder"));
  assert.ok(types.has("memory_save") || types.has("preference"));
  assert.equal(shouldCreateCaptureSession(text, draft), true);
});

await test("21. manual Telegram mixed phrase (потом / появилась идея / 12 млн)", () => {
  const text =
    "Сегодня потратил 80 тысяч на кофе, потом 300 тысяч на продукты, получил 12 миллионов, появилась идея открыть кофейню, завтра позвонить Арману, и запомни что мне нравится работать ночью.";
  const draft = buildDeterministicCaptureDraft(text);
  const byType = Object.groupBy
    ? null
    : null;
  const expenses = draft.actions.filter((a) => a.type === "finance_expense");
  const incomes = draft.actions.filter((a) => a.type === "finance_income");
  const ideas = draft.actions.filter((a) => a.type === "idea_create");
  assert.equal(expenses.length, 2);
  assert.equal(incomes.length, 1);
  assert.equal(incomes[0].payload.amount, 12_000_000);
  assert.ok(ideas.some((i) => /кофейн/i.test(i.content)));
  assert.ok(draft.actions.some((a) => a.type === "task_create"));
  assert.ok(
    draft.actions.some(
      (a) => a.type === "preference" || a.type === "memory_save"
    )
  );
  assert.equal(shouldCreateCaptureSession(text, draft), true);
  const preview = formatCapturePreview({ draft });
  assert.match(preview, /Captured/);
  assert.match(preview, /Expenses ×2/);
  assert.match(preview, /Income ×1/);
  assert.match(preview, /Idea/);
});

console.log(`\ncapture-session: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
