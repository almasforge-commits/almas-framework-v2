import assert from "node:assert/strict";

import { decideRouting, getExecutedOwnedActions } from "../services/inbox/routingDecisionService.js";
import { resetExecutionIdempotencyCacheForTests } from "../services/inbox/actionExecutor.js";
import { sendAiExecutionConfirmations } from "../handlers/routes/aiExecutionRoute.js";

// End-to-end pipeline tests: normalize -> Tier 0 -> Tier 1 -> escalation
// -> Tier 2 -> Safety Validator. A fake PlannerProvider is always
// injected — never calls real OpenAI/Telegram/Supabase. Each scenario
// below mirrors one of the milestone's required test cases.

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((error) => {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

const silence = { configOverrides: {} };

function contract(overrides = {}) {
  return {
    language: "ru",
    actions: [],
    needsClarification: false,
    clarificationQuestion: null,
    shouldEscalate: false,
    reasonCode: "test",
    ...overrides,
  };
}

/** A provider whose behavior is scripted per call, tracking call counts per model. */
function scriptedProvider(handlersByModel) {
  const calls = { total: 0, byModel: {} };
  return {
    calls,
    provider: {
      name: "scripted",
      async run(input, { model }) {
        calls.total += 1;
        calls.byModel[model] = (calls.byModel[model] || 0) + 1;
        const handler = handlersByModel[model];
        if (!handler) throw new Error(`no handler scripted for model ${model}`);
        return handler(input);
      },
    },
  };
}

async function run() {
  await test("Russian: 'Сегодня потратил сорок тысяч на кофе' -> finance_expense 40000 via Tier 0 (no AI call)", async () => {
    const { provider, calls } = scriptedProvider({});
    const decision = await decideRouting("Сегодня потратил сорок тысяч на кофе", { provider });
    assert.equal(decision.tier, "deterministic");
    assert.equal(calls.total, 0, "Tier 0 should resolve this without ever calling the AI provider");
    assert.equal(decision.actions[0].type, "finance_expense");
    assert.equal(decision.actions[0].payload.amount, 40000);
  });

  await test("English: 'I spent 20 dollars on lunch' -> finance_expense 20 USD via Tier 1", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: { model: "gpt-5-nano", latencyMs: 5 },
        result: contract({
          language: "en",
          actions: [
            { type: "finance_expense", confidence: 0.96, payload: { amount: 20, currency: "USD", description: "lunch" }, requiresConfirmation: false },
          ],
          reasonCode: "clear_expense",
        }),
      }),
    });
    const decision = await decideRouting("I spent 20 dollars on lunch", { provider });
    assert.equal(decision.tier, "cheap");
    assert.equal(decision.actions[0].type, "finance_expense");
    assert.equal(decision.actions[0].payload.amount, 20);
    assert.equal(decision.actions[0].payload.currency, "USD");
  });

  await test("Kazakh with an extractable amount -> finance_expense, never hallucinated", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          language: "kk",
          actions: [
            { type: "finance_expense", confidence: 0.9, payload: { amount: 5000, currency: "KZT", description: "кофе" }, requiresConfirmation: false },
          ],
          reasonCode: "clear_expense",
        }),
      }),
    });
    const decision = await decideRouting("Бүгін кофеге бес мың теңге жұмсадым", { provider });
    assert.equal(decision.actions[0].payload.amount, 5000);
    assert.equal(decision.actions[0].payload.currency, "KZT");
  });

  await test("Kazakh with NO extractable amount -> clarification, never a hallucinated action", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          language: "kk",
          actions: [],
          needsClarification: true,
          clarificationQuestion: "Қанша жұмсадыңыз?",
          reasonCode: "ambiguous_amount",
        }),
      }),
    });
    const decision = await decideRouting("Кофеге біраз жұмсадым", { provider });
    assert.equal(decision.actions.length, 0);
    assert.equal(decision.needsClarification, true);
  });

  await test("Mixed: 'Завтра reminder купить батарейки' -> task_create via Tier 1", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          language: "mixed",
          actions: [{ type: "task_create", confidence: 0.92, payload: { content: "купить батарейки", date: "завтра" }, requiresConfirmation: false }],
          reasonCode: "clear_task",
        }),
      }),
    });
    const decision = await decideRouting("Завтра reminder купить батарейки", { provider });
    assert.equal(decision.actions[0].type, "task_create");
  });

  await test("Multiple actions: a CONFIDENT, complete plan stays on Tier 1 (cheap), ordered, no escalation", async () => {
    const { provider, calls } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            { type: "finance_expense", confidence: 0.95, payload: { amount: 40000, currency: "VND", description: "кофе" }, requiresConfirmation: false },
            { type: "task_create", confidence: 0.93, payload: { content: "купить батарейки" }, requiresConfirmation: false },
          ],
          reasonCode: "multi_action_confident",
        }),
      }),
    });
    // The message deliberately escapes Tier 0's finance-only parse (see
    // deterministicIntentDetector.js's MULTI_ACTION_HINT_REGEX) so it
    // reaches the AI tiers, matching the milestone's "multiple actions"
    // example exactly.
    const decision = await decideRouting("Потратил 40000 на кофе и завтра купить батарейки", { provider });
    assert.equal(decision.tier, "cheap", "a confident, complete multi-action plan must not escalate to Tier 2");
    assert.equal(calls.byModel["gpt-5-mini"], undefined);
    assert.equal(decision.actions.length, 2);
    assert.equal(decision.actions[0].type, "finance_expense");
    assert.equal(decision.actions[1].type, "task_create");
  });

  await test("Multiple actions with low confidence: escalates to Tier 2 exactly once, order preserved", async () => {
    const { provider, calls } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            { type: "finance_expense", confidence: 0.4, payload: { amount: 40000, currency: "VND", description: "кофе" }, requiresConfirmation: false },
            { type: "task_create", confidence: 0.9, payload: { content: "купить батарейки" }, requiresConfirmation: false },
          ],
          reasonCode: "multi_action_uncertain",
        }),
      }),
      "gpt-5-mini": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            { type: "finance_expense", confidence: 0.95, payload: { amount: 40000, currency: "VND", description: "кофе" }, requiresConfirmation: false },
            { type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false },
          ],
          reasonCode: "multi_action_resolved",
        }),
      }),
    });
    const decision = await decideRouting("Потратил 40000 на кофе и завтра купить батарейки", { provider });
    assert.equal(decision.tier, "medium");
    assert.equal(calls.byModel["gpt-5-mini"], 1);
    assert.equal(decision.actions.length, 2);
    assert.equal(decision.actions[0].type, "finance_expense");
    assert.equal(decision.actions[1].type, "task_create");
  });

  await test("Memory: 'Запомни, что мне нравится это кафе' -> memory_save", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "memory_save", confidence: 0.95, payload: { content: "мне нравится это кафе" }, requiresConfirmation: false }],
          reasonCode: "clear_memory",
        }),
      }),
    });
    const decision = await decideRouting("Запомни, что мне нравится это кафе", { provider });
    assert.equal(decision.actions[0].type, "memory_save");
  });

  await test("Knowledge: 'Что автор говорил про монетизацию?' -> knowledge_query", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "knowledge_query", confidence: 0.9, payload: { query: "монетизация" }, requiresConfirmation: false }],
          reasonCode: "clear_knowledge_query",
        }),
      }),
    });
    const decision = await decideRouting("Что автор говорил про монетизацию?", { provider });
    assert.equal(decision.actions[0].type, "knowledge_query");
  });

  await test("Ambiguous amount: 'Потратил немного на кофе' -> clarification, no finance execution", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "finance_expense", confidence: 0.3, payload: { amount: null, currency: null, description: "кофе" }, requiresConfirmation: false }],
          needsClarification: true,
          clarificationQuestion: "Сколько именно вы потратили на кофе?",
          reasonCode: "ambiguous_amount",
        }),
      }),
    });
    const decision = await decideRouting("Потратил немного на кофе", { provider });
    assert.equal(decision.actions.length, 0, "no finance action may execute without a real amount");
    assert.equal(decision.needsClarification, true);
    assert.equal(decision.wouldExecute, false);
  });

  await test("Destructive: 'Удалите все знания' -> requiresConfirmation:true, never auto-executed", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "system_command", confidence: 0.99, payload: { command: "delete_all_knowledge" }, requiresConfirmation: false }],
          reasonCode: "destructive_request",
        }),
      }),
    });
    const decision = await decideRouting("Удалите все знания", { provider, inputSource: "text" });
    assert.equal(decision.actions[0].requiresConfirmation, true);
    assert.equal(decision.wouldExecute, false);
    assert.equal(decision.executed, false);
  });

  await test("Destructive via voice is rejected outright, not merely flagged", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "system_command", confidence: 0.99, payload: { command: "delete_all_knowledge" }, requiresConfirmation: false }],
          reasonCode: "destructive_request",
        }),
      }),
    });
    const decision = await decideRouting("удалите все знания пожалуйста", { provider, inputSource: "voice" });
    assert.equal(decision.actions.length, 0);
    assert.equal(decision.rejectedActions[0].reason, "voice_destructive_blocked");
  });

  await test("Garbage transcript -> unknown/clarification, never Memory by default", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          language: "unknown",
          actions: [],
          needsClarification: true,
          clarificationQuestion: null,
          reasonCode: "no_actionable_intent",
        }),
      }),
    });
    const decision = await decideRouting("шиჵმხტი მუემიში", { provider, inputSource: "voice" });
    assert.equal(decision.actions.every((a) => a.type !== "memory_save"), true);
    assert.equal(decision.needsClarification, true);
  });

  await test("Provider failure -> deterministic fallback, no crash", async () => {
    const provider = { name: "broken", run: async () => { throw new Error("network down"); } };
    const decision = await decideRouting("Расскажи анекдот про кота", { provider });
    assert.equal(decision.tier, "fallback");
    assert.equal(decision.actions.length, 0);
    assert.equal(decision.needsClarification, true);
    assert.equal(decision.executed, false);
  });

  await test("Cheap-model low confidence -> medium tier called exactly once", async () => {
    const { provider, calls } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({ actions: [{ type: "finance_expense", confidence: 0.2, payload: { amount: 1, currency: "USD" }, requiresConfirmation: false }] }),
      }),
      "gpt-5-mini": async () => ({
        ok: true,
        usage: null,
        result: contract({ actions: [{ type: "finance_expense", confidence: 0.9, payload: { amount: 1, currency: "USD" }, requiresConfirmation: false }] }),
      }),
    });
    await decideRouting("some ambiguous long context-dependent message", { provider });
    assert.equal(calls.byModel["gpt-5-mini"], 1);
  });

  await test("Cheap-model high confidence -> medium tier not called", async () => {
    const { provider, calls } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({ actions: [{ type: "chat", confidence: 0.97, payload: { query: "hi" }, requiresConfirmation: false }] }),
      }),
    });
    await decideRouting("a simple clear message", { provider });
    assert.equal(calls.byModel["gpt-5-mini"], undefined);
  });

  await test("Unknown action type returned by provider -> rejected by validator", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({ actions: [{ type: "delete_everything_now", confidence: 0.99, payload: {}, requiresConfirmation: false }] }),
      }),
    });
    const decision = await decideRouting("some message", { provider });
    assert.equal(decision.actions.length, 0);
    assert.equal(decision.rejectedActions[0].reason, "unknown_action_type");
  });

  await test("Shadow mode: decideRouting never calls any domain executor (module boundary check)", async () => {
    const fs = await import("node:fs/promises");
    const forbiddenImportPattern = /from\s+["'].*\/(financeService|memoryService|taskService|taskUpdateService|knowledgeService|chatService|bot)\.js["']/;
    const filesToCheck = [
      "../services/inbox/routingDecisionService.js",
      "../services/inbox/aiIntentAnalyzer.js",
      "../services/inbox/actionPlanner.js",
      "../services/inbox/actionValidator.js",
      "../services/inbox/deterministicIntentDetector.js",
      "../providers/ai/plannerProvider.js",
      "../providers/ai/openaiPlannerProvider.js",
    ];
    for (const relativePath of filesToCheck) {
      const source = await fs.readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.equal(
        forbiddenImportPattern.test(source),
        false,
        `${relativePath} must never import a domain-executing service`
      );
    }
  });

  await test("Shadow mode: a decision is always returned with executed:false and wouldExecute is informational only", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({ actions: [{ type: "chat", confidence: 0.99, payload: { query: "hi" }, requiresConfirmation: false }] }),
      }),
    });
    const decision = await decideRouting("hi there", { provider });
    assert.equal(decision.executed, false);
    assert.equal(decision.mode, "shadow");
  });

  await test("Kill switch: AI_ROUTER_MODE=off skips everything, no AI call", async () => {
    const { provider, calls } = scriptedProvider({});
    const decision = await decideRouting("Расскажи анекдот", {
      provider,
      configOverrides: { mode: "off" },
    });
    assert.equal(decision.skipped, true);
    assert.equal(calls.total, 0);
  });

  await test("Active mode: a validated task_create executes exactly once through the injected executor", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const decision = await decideRouting("Завтра reminder купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      executorDeps: {
        saveMemoryFn: async (record) => {
          saveMemoryCalls += 1;
          assert.equal(record.metadata.memoryType, "task");
          return true;
        },
      },
    });
    assert.equal(saveMemoryCalls, 1);
    assert.equal(decision.executedCount, 1);
    assert.equal(decision.execution[0].reason, "task_created");
  });

  await test("Active mode: a validated memory_save executes exactly once through the injected executor", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "memory_save", confidence: 0.95, payload: { content: "мне нравится это кафе" }, requiresConfirmation: false }],
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const decision = await decideRouting("Запомни, что мне нравится это кафе", {
      provider,
      configOverrides: { mode: "active" },
      executorDeps: {
        classifyMemoryFn: () => ({ memoryType: "note", importance: 5, status: "active", tags: [] }),
        saveMemoryFn: async () => {
          saveMemoryCalls += 1;
          return true;
        },
      },
    });
    assert.equal(saveMemoryCalls, 1);
    assert.equal(decision.executedCount, 1);
    assert.equal(decision.execution[0].reason, "memory_saved");
  });

  await test("Active mode: a finance action is skipped, never executed (deterministic Finance stays authoritative)", async () => {
    const decision = await decideRouting("Потратил 40000 на кофе", {
      configOverrides: { mode: "active" },
      executorDeps: { saveMemoryFn: async () => { throw new Error("must not be called"); } },
    });
    assert.equal(decision.tier, "deterministic");
    assert.equal(decision.executedCount, 0);
    assert.equal(decision.execution[0].reason, "skipped_finance_not_enabled");
  });

  await test("Active mode: a destructive action is skipped, never executed", async () => {
    const decision = await decideRouting("удалить все знания", {
      configOverrides: { mode: "active" },
      executorDeps: { saveMemoryFn: async () => { throw new Error("must not be called"); } },
    });
    assert.equal(decision.executedCount, 0);
    assert.equal(decision.execution[0].reason, "skipped_requires_confirmation");
  });

  await test("Shadow mode executes nothing, even for a task_create/memory_save action", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    const decision = await decideRouting("Завтра reminder купить батарейки", {
      provider,
      executorDeps: { saveMemoryFn: async () => { throw new Error("must not be called in shadow mode"); } },
    });
    assert.equal(decision.mode, "shadow");
    assert.equal(decision.executedCount, 0);
    assert.equal(decision.execution[0].reason, "skipped_shadow_mode");
  });

  await test("A domain-service failure during execution does not crash routing", async () => {
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    const decision = await decideRouting("Завтра reminder купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      executorDeps: { saveMemoryFn: async () => { throw new Error("Supabase is down"); } },
    });
    assert.equal(decision.executedCount, 0);
    assert.equal(decision.execution[0].reason, "domain_error");
  });

  await test("Kill switch: AI_ROUTER_ENABLED=false skips everything, no AI call", async () => {
    const { provider, calls } = scriptedProvider({});
    const decision = await decideRouting("Расскажи анекдот", {
      provider,
      configOverrides: { enabled: false },
    });
    assert.equal(decision.skipped, true);
    assert.equal(calls.total, 0);
  });

  // --- Execution-ownership milestone: getExecutedOwnedActions() -------

  await test("getExecutedOwnedActions: empty for a null/undefined/skipped decision", () => {
    assert.deepEqual(getExecutedOwnedActions(null), { executedActions: [] });
    assert.deepEqual(getExecutedOwnedActions(undefined), { executedActions: [] });
    assert.deepEqual(getExecutedOwnedActions({ skipped: true, reason: "disabled" }), { executedActions: [] });
  });

  await test("getExecutedOwnedActions: only includes results with executed === true AND type task_create/memory_save", () => {
    const decision = {
      execution: [
        { action: { type: "task_create", payload: {} }, executed: true, reason: "task_created" },
        { action: { type: "memory_save", payload: {} }, executed: false, reason: "domain_error" },
        { action: { type: "finance_expense", payload: {} }, executed: false, reason: "skipped_finance_not_enabled" },
        { action: { type: "task_create", payload: {} }, executed: false, reason: "skipped_shadow_mode" },
      ],
    };
    const { executedActions } = getExecutedOwnedActions(decision);
    assert.equal(executedActions.length, 1);
    assert.equal(executedActions[0].reason, "task_created");
  });

  await test("getExecutedOwnedActions: executed:false must never be treated as ownership (never blocks legacy Memory)", () => {
    const decision = {
      execution: [{ action: { type: "memory_save", payload: { content: "x" } }, executed: false, reason: "skipped_shadow_mode" }],
    };
    assert.deepEqual(getExecutedOwnedActions(decision), { executedActions: [] });
  });

  // --- Execution-ownership milestone: end-to-end active-mode scenarios,
  // combining decideRouting -> getExecutedOwnedActions ->
  // sendAiExecutionConfirmations exactly as handlers/messageHandler.js
  // does (messageHandler.js itself can't be safely imported here — see
  // scripts/test-message-router-extraction.js for the source-level
  // control-flow checks). ----------------------------------------------

  await test("Pure task ('Завтра купить батарейки'): task_create executes once, ownership includes it, one confirmation is rendered", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:1",
      executorDeps: { saveMemoryFn: async () => { saveMemoryCalls += 1; return true; } },
    });
    const { executedActions } = getExecutedOwnedActions(decision);
    assert.equal(saveMemoryCalls, 1);
    assert.equal(executedActions.length, 1);

    const sendMessageFn = async (chatId, text) => ({ chatId, text });
    const sentTexts = [];
    await sendAiExecutionConfirmations("chat1", executedActions, {
      sendMessageFn: async (chatId, text) => sentTexts.push(text),
    });
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0], /Task saved/);
  });

  await test("Pure memory ('Запомни, что мне нравится работать ночью'): memory_save executes once, one confirmation is rendered, not duplicated", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "memory_save", confidence: 0.95, payload: { content: "мне нравится работать ночью" }, requiresConfirmation: false }],
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const decision = await decideRouting("Запомни, что мне нравится работать ночью", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:2",
      executorDeps: {
        classifyMemoryFn: () => ({ memoryType: "note", importance: 5, status: "active", tags: [] }),
        saveMemoryFn: async () => { saveMemoryCalls += 1; return true; },
      },
    });
    const { executedActions } = getExecutedOwnedActions(decision);
    assert.equal(saveMemoryCalls, 1);
    assert.equal(executedActions.length, 1);

    const sentTexts = [];
    await sendAiExecutionConfirmations("chat1", executedActions, {
      sendMessageFn: async (chatId, text) => sentTexts.push(text),
    });
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0], /Saved/);
  });

  await test("Finance + Task ('Потратил 40000 на кофе и завтра купить батарейки'): task_create executes once via the AI router (Finance's own execution is the deterministic parser's job, covered in test-finance-description-cleanup.js)", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [
            { type: "finance_expense", confidence: 0.95, payload: { amount: 40000, currency: "VND", description: "кофе" }, requiresConfirmation: false },
            { type: "task_create", confidence: 0.93, payload: { content: "купить батарейки" }, requiresConfirmation: false },
          ],
          reasonCode: "multi_action_confident",
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const decision = await decideRouting("Потратил 40000 на кофе и завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:3",
      executorDeps: { saveMemoryFn: async () => { saveMemoryCalls += 1; return true; } },
    });
    const { executedActions } = getExecutedOwnedActions(decision);
    // Finance stays legacy-owned: the AI router never executes it
    // (skipped_finance_not_enabled), only task_create is AI-owned here.
    assert.equal(saveMemoryCalls, 1);
    assert.equal(executedActions.length, 1);
    assert.equal(executedActions[0].action.type, "task_create");

    const sentTexts = [];
    await sendAiExecutionConfirmations("chat1", executedActions, {
      sendMessageFn: async (chatId, text) => sentTexts.push(text),
    });
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0], /Task saved/);
  });

  await test("Provider failure in active mode: ownership stays empty (normal legacy fallback runs)", async () => {
    resetExecutionIdempotencyCacheForTests();
    const provider = { name: "broken", run: async () => { throw new Error("network down"); } };
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:4",
      executorDeps: { saveMemoryFn: async () => { throw new Error("must not be called"); } },
    });
    assert.equal(decision.tier, "fallback");
    assert.deepEqual(getExecutedOwnedActions(decision), { executedActions: [] });
  });

  await test("Idempotency: repeated same requestKey (message_id) does not execute the same AI action twice", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const deps = { executorDeps: { saveMemoryFn: async () => { saveMemoryCalls += 1; return true; } } };

    const first = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:5",
      ...deps,
    });
    const second = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:5",
      ...deps,
    });

    assert.equal(getExecutedOwnedActions(first).executedActions.length, 1);
    assert.equal(getExecutedOwnedActions(second).executedActions.length, 0);
    assert.equal(second.execution[0].reason, "skipped_duplicate_request");
    assert.equal(saveMemoryCalls, 1, "the domain service must only ever be called once across both decideRouting() calls");
  });

  await test("Idempotency: different requestKeys (message_ids) with identical text execute independently", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    let saveMemoryCalls = 0;
    const deps = { executorDeps: { saveMemoryFn: async () => { saveMemoryCalls += 1; return true; } } };

    const first = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:6",
      ...deps,
    });
    const second = await decideRouting("Завтра купить батарейки", {
      provider,
      configOverrides: { mode: "active" },
      requestKey: "msg:1:7",
      ...deps,
    });

    assert.equal(getExecutedOwnedActions(first).executedActions.length, 1);
    assert.equal(getExecutedOwnedActions(second).executedActions.length, 1);
    assert.equal(saveMemoryCalls, 2);
  });

  await test("Shadow mode (the default): ownership is always empty, so no AI execution confirmation is ever sent", async () => {
    resetExecutionIdempotencyCacheForTests();
    const { provider } = scriptedProvider({
      "gpt-5-nano": async () => ({
        ok: true,
        usage: null,
        result: contract({
          actions: [{ type: "task_create", confidence: 0.95, payload: { content: "купить батарейки" }, requiresConfirmation: false }],
        }),
      }),
    });
    // No configOverrides.mode -> defaults to AI_ROUTER_MODE ("shadow" unless overridden in this process's env).
    const decision = await decideRouting("Завтра купить батарейки", {
      provider,
      requestKey: "msg:1:8",
      executorDeps: { saveMemoryFn: async () => { throw new Error("must not be called in shadow mode"); } },
    });
    assert.equal(decision.mode, "shadow");
    const { executedActions } = getExecutedOwnedActions(decision);
    assert.equal(executedActions.length, 0);

    let sendCalls = 0;
    const sentCount = await sendAiExecutionConfirmations("chat1", executedActions, {
      sendMessageFn: async () => { sendCalls += 1; },
    });
    assert.equal(sendCalls, 0);
    assert.equal(sentCount, 0);
  });

  if (process.exitCode) {
    console.error("\nSome routing-decision-service tests failed.");
  } else {
    console.log("\nAll routing-decision-service tests passed.");
  }
}

run();
