import assert from "node:assert/strict";

import {
  canonicalizeActionPayload,
  normalizeRoutingContract,
  createAction,
  createRoutingContract,
} from "../services/inbox/contracts.js";
import { validateRoutingContract } from "../services/inbox/actionValidator.js";
import { shouldEscalateToMediumTier } from "../services/inbox/actionPlanner.js";
import {
  executeActions,
  resetExecutionIdempotencyCacheForTests,
} from "../services/inbox/actionExecutor.js";
import {
  decideRouting,
  getExecutedOwnedActions,
  summarizeSkippedReasons,
} from "../services/inbox/routingDecisionService.js";
import { detectDeterministicIntent } from "../services/inbox/deterministicIntentDetector.js";
import { shouldSaveMemory } from "../services/storage/memoryFilter.js";
import { describeMemorySaveLog } from "../services/storage/memoryService.js";
import { MENU_NAVIGATION_COMMANDS } from "../core/utils/menuNavigationCommands.js";
import { parseFinanceMessage } from "../services/finance/financeParser.js";
import { sendAiExecutionConfirmations } from "../handlers/routes/aiExecutionRoute.js";

// Bounded regressions for the three active-mode issues:
// (A) task payload aliases, (B) menu/deterministic AI fast path,
// (C) semantic Task logging. No real OpenAI / Telegram / Supabase.

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

function scriptedProvider(byModel) {
  const calls = [];
  return {
    provider: {
      name: "scripted",
      run: async (input, { model }) => {
        calls.push({ model, input });
        const handler = byModel[model];
        if (!handler) throw new Error(`unexpected model ${model}`);
        return handler(input);
      },
    },
    calls,
  };
}

function contract(overrides = {}) {
  return createRoutingContract({
    language: "ru",
    needsClarification: false,
    clarificationQuestion: null,
    shouldEscalate: false,
    reasonCode: "test",
    ...overrides,
  });
}

async function run() {
  resetExecutionIdempotencyCacheForTests();

  await test("canonicalizeActionPayload: title/text aliases fold into content for task_create", () => {
    assert.deepEqual(
      canonicalizeActionPayload("task_create", { title: "Купить батарейки" }).content,
      "Купить батарейки"
    );
    assert.deepEqual(
      canonicalizeActionPayload("task_create", { text: "позвонить в банк" }).content,
      "позвонить в банк"
    );
    assert.equal(
      canonicalizeActionPayload("task_create", { content: "a", title: "b" }).content,
      "a",
      "content wins over title"
    );
  });

  await test("canonicalizeActionPayload: does not invent content when every alias is empty", () => {
    const payload = canonicalizeActionPayload("task_create", { title: "  ", text: "" });
    assert.equal(payload.content, undefined);
  });

  await test("normalizeRoutingContract / validator: payload.title becomes canonical content", () => {
    const raw = createRoutingContract({
      language: "ru",
      actions: [
        createAction({
          type: "task_create",
          confidence: 0.95,
          payload: { title: "Купить батарейки" },
        }),
      ],
      reasonCode: "clear_task",
    });
    const normalized = normalizeRoutingContract(raw);
    assert.equal(normalized.actions[0].payload.content, "Купить батарейки");

    const validated = validateRoutingContract(raw, { inputSource: "text" });
    assert.equal(validated.actions[0].payload.content, "Купить батарейки");
    assert.equal(validated.wouldExecute, true);
  });

  await test("cheap-tier task with payload.content executes", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider, calls } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "task_create",
              confidence: 0.95,
              payload: { content: "купить батарейки" },
              requiresConfirmation: false,
            },
          ],
          reasonCode: "clear_task",
        }),
      }),
    });
    let saveCalls = 0;
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:reg:1",
      executorDeps: { saveMemoryFn: async () => { saveCalls += 1; return true; } },
    });
    assert.equal(decision.tier, "cheap");
    assert.equal(calls.length, 1);
    assert.equal(saveCalls, 1);
    assert.equal(getExecutedOwnedActions(decision).executedActions.length, 1);
    assert.equal(decision.execution[0].type, "task_create");
  });

  await test("medium-tier task with payload.title executes (no missing_content skip)", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "task_create",
              confidence: 0.4,
              payload: { title: "Купить батарейки" },
              requiresConfirmation: false,
            },
          ],
          reasonCode: "clear_task",
          shouldEscalate: true,
        }),
      }),
      "gpt-5-mini": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "task_create",
              confidence: 0.95,
              payload: { title: "Купить батарейки" },
              requiresConfirmation: false,
            },
          ],
          reasonCode: "clear_task",
        }),
      }),
    });
    let saveCalls = 0;
    let savedContent = null;
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:reg:2",
      executorDeps: {
        saveMemoryFn: async (record) => {
          saveCalls += 1;
          savedContent = record.content;
          return true;
        },
      },
    });
    assert.equal(decision.tier, "medium");
    assert.equal(saveCalls, 1);
    assert.equal(savedContent, "Купить батарейки");
    assert.equal(decision.execution[0].executed, true);
    assert.equal(decision.execution[0].type, "task_create");
    assert.equal(decision.actions[0].payload.content, "Купить батарейки");
  });

  await test("task with only payload.title does NOT escalate merely for 'missing content'", () => {
    const cheapResult = {
      ok: true,
      contract: {
        language: "ru",
        actions: [
          { type: "task_create", confidence: 0.95, payload: { title: "Купить батарейки" } },
        ],
        needsClarification: false,
        shouldEscalate: false,
        reasonCode: "clear_task",
      },
    };
    assert.equal(
      shouldEscalateToMediumTier(cheapResult, { normalized: "Завтра купить батарейки" }),
      false
    );
  });

  await test("genuinely missing task content is skipped with skipped_missing_task_content", async () => {
    const { results } = await executeActions(
      [createAction({ type: "task_create", confidence: 0.9, payload: {} })],
      { mode: "active" },
      { saveMemoryFn: async () => { throw new Error("must not run"); } }
    );
    assert.equal(results[0].executed, false);
    assert.equal(results[0].reason, "skipped_missing_task_content");
    assert.equal(results[0].type, "task_create");
  });

  await test("summarizeSkippedReasons aggregates precise codes without message content", () => {
    const summary = summarizeSkippedReasons([
      { executed: false, reason: "skipped_missing_task_content" },
      { executed: false, reason: "skipped_finance_not_enabled" },
      { executed: true, reason: "task_created" },
      { executed: false, reason: "skipped_missing_task_content" },
    ]);
    assert.equal(summary, "skipped_finance_not_enabled:1,skipped_missing_task_content:2");
    assert.doesNotMatch(summary, /батар|кофе|памят/i);
  });

  await test("skipped reason appears on the decideRouting decision (and therefore in sanitized logs)", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "task_create",
              confidence: 0.95,
              payload: {},
              requiresConfirmation: false,
            },
          ],
          reasonCode: "clear_task",
        }),
      }),
    });
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:reg:3",
      executorDeps: { saveMemoryFn: async () => true },
    });
    assert.equal(decision.executedCount, 0);
    assert.match(decision.skippedReasons, /skipped_missing_task_content/);
    assert.deepEqual(getExecutedOwnedActions(decision), { executedActions: [] });
  });

  await test("every main menu label is a Tier-0 final decision (zero AI provider calls)", async () => {
    for (const label of MENU_NAVIGATION_COMMANDS) {
      const { provider, calls } = scriptedProvider({
        "gpt-5-nano": async () => {
          throw new Error(`AI must not be called for menu label: ${label}`);
        },
      });
      const decision = await decideRouting(label, {
        provider,
        configOverrides: { mode: "shadow" },
      });
      assert.equal(calls.length, 0, `expected zero AI calls for "${label}"`);
      assert.equal(decision.tier, "deterministic");
      assert.equal(decision.reasonCode, "menu_navigation");
      assert.equal(detectDeterministicIntent(label)?.reasonCode, "menu_navigation");
    }
  });

  await test("exact deterministic commands make zero AI provider calls", async () => {
    const commands = ["баланс", "мои задачи", "мои знания", "история", "статистика", "привет"];
    for (const command of commands) {
      const { provider, calls } = scriptedProvider({
        "gpt-5-nano": async () => {
          throw new Error(`AI must not be called for exact command: ${command}`);
        },
      });
      const decision = await decideRouting(command, {
        provider,
        configOverrides: { mode: "shadow" },
      });
      assert.equal(calls.length, 0, `expected zero AI calls for "${command}"`);
      assert.equal(decision.tier, "deterministic");
    }
  });

  await test("menu labels never reach Memory (shouldSaveMemory=false)", () => {
    for (const label of MENU_NAVIGATION_COMMANDS) {
      assert.equal(shouldSaveMemory(label), false, label);
      assert.equal(shouldSaveMemory(label.toUpperCase()), false, label);
    }
  });

  await test("task execution uses semantic Task logging label", () => {
    assert.equal(describeMemorySaveLog({ actionType: "task_create" }), "Сохраняю задачу");
    assert.equal(describeMemorySaveLog({ memoryType: "task" }), "Сохраняю задачу");
    assert.equal(describeMemorySaveLog({ memoryType: "note" }), "Сохраняю память");
    assert.equal(describeMemorySaveLog({ actionType: "memory_save" }), "Сохраняю память");
  });

  await test("pure Task blocks legacy Memory ownership only when executed=true", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "task_create",
              confidence: 0.95,
              payload: { content: "купить батарейки" },
              requiresConfirmation: false,
            },
          ],
        }),
      }),
    });
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:reg:4",
      executorDeps: { saveMemoryFn: async () => true },
    });
    assert.equal(getExecutedOwnedActions(decision).executedActions.length, 1);
  });

  await test("failed/skipped Task leaves ownership empty (safe legacy fallback allowed)", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "task_create",
              confidence: 0.95,
              payload: { title: "" },
              requiresConfirmation: false,
            },
          ],
        }),
      }),
    });
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:reg:5",
      executorDeps: { saveMemoryFn: async () => true },
    });
    assert.deepEqual(getExecutedOwnedActions(decision), { executedActions: [] });
    assert.match(decision.skippedReasons, /skipped_missing_task_content/);
  });

  await test("mixed Finance+Task: one Finance description 'кофе', one AI task, AI finance skipped, no Memory ownership of whole message", async () => {
    resetExecutionIdempotencyCacheForTests();
    const text = "Потратил 40000 на кофе и завтра купить батарейки";

    const finance = parseFinanceMessage(text);
    assert.ok(finance);
    assert.equal(finance.description, "кофе");

    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            {
              type: "finance_expense",
              confidence: 0.95,
              payload: { amount: 40000, currency: "VND", description: "кофе" },
              requiresConfirmation: false,
            },
            {
              type: "task_create",
              confidence: 0.93,
              payload: { title: "купить батарейки" },
              requiresConfirmation: false,
            },
          ],
          reasonCode: "multi_action_confident",
        }),
      }),
    });

    let saveCalls = 0;
    const decision = await decideRouting(text, {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:reg:6",
      executorDeps: {
        saveMemoryFn: async (record) => {
          saveCalls += 1;
          assert.equal(record.metadata.memoryType, "task");
          assert.equal(record.metadata.actionType, "task_create");
          return true;
        },
      },
    });

    assert.equal(saveCalls, 1);
    const owned = getExecutedOwnedActions(decision).executedActions;
    assert.equal(owned.length, 1);
    assert.equal(owned[0].action.type, "task_create");

    const financeSkip = decision.execution.find((r) => r.action.type === "finance_expense");
    assert.ok(financeSkip);
    assert.equal(financeSkip.executed, false);
    assert.equal(financeSkip.reason, "skipped_finance_not_enabled");

    const sent = [];
    await sendAiExecutionConfirmations("chat1", owned, {
      sendMessageFn: async (_chatId, message) => sent.push(message),
    });
    assert.deepEqual(sent, ["✅ Задача сохранена\n\nкупить батарейки"]);

    // Whole mixed message must not be Memory-eligible as a note.
    assert.equal(shouldSaveMemory(text), false);
  });

  if (process.exitCode) {
    console.error("\nSome active-mode-regressions tests failed.");
  } else {
    console.log("\nAll active-mode-regressions tests passed.");
  }
}

run();
