/**
 * Telegram + domain boundary for Clarification Engine.
 * Engine stays free of bot/Supabase imports; this module owns sends/writes.
 */

import { executeActions } from "../../services/inbox/actionExecutor.js";
import { addExpense, addIncome } from "../../services/finance/financeService.js";
import { detectCategory } from "../../services/finance/categorizer.js";
import { formatAiExecutionConfirmation } from "./aiExecutionRoute.js";
import {
  createClarificationEngine,
  defaultClarificationEngine,
} from "../../services/context/clarificationEngine.js";
import { detectIncompleteIntent } from "../../services/context/contextContracts.js";
import { isAiRouterExecutionActive } from "../../config/aiRouter.js";
import { parseFinanceMessage } from "../../services/finance/financeParser.js";
import { missingFinanceClarificationFields } from "../../services/context/contextContracts.js";
import {
  MINI_APP_PATHS,
  THIN_CONFIRM,
  withMiniAppOpenButton,
} from "../../config/deepLinks.js";

let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

const defaultSendMessageFn = async (chatId, text, extra) =>
  (await getBot()).sendMessage(chatId, text, extra);

/**
 * Process pending clarification answers, or start incomplete task/memory.
 *
 * @returns {Promise<{ handled: boolean, reason?: string }>}
 */
export async function handleClarificationTurn(input = {}, options = {}) {
  const {
    chatId,
    text,
    from,
    actor,
    requestKey = null,
    inputSource = "text",
  } = input;

  const {
    engine = defaultClarificationEngine,
    sendMessageFn = defaultSendMessageFn,
    executeActionsFn = executeActions,
    addExpenseFn = addExpense,
    addIncomeFn = addIncome,
    aiRouterActiveFn = isAiRouterExecutionActive,
  } = options;

  const actorKey = actor?.actorKey || `telegram:${from?.id ?? "unknown"}`;
  const userId = String(from?.id ?? "default");

  // Idempotency: a requestKey that already completed must not re-run.
  if (requestKey && engine.store.hasProcessedRequestKey(requestKey)) {
    return { handled: true, reason: "duplicate" };
  }

  // 1) Pending answer path (works for any mode once a question was sent).
  const existing = engine.getPending(actorKey, chatId);
  if (existing) {
    const result = engine.handleAnswer({
      actorKey,
      chatId,
      answerText: text,
      requestKey,
    });

    if (result.status === "duplicate") {
      return { handled: true, reason: "duplicate" };
    }

    if (result.status === "cancelled") {
      await safeSend(sendMessageFn, chatId, "Операция отменена.");
      return { handled: true, reason: "cancelled" };
    }

    if (result.status === "expired") {
      // Clear already done by store.get; process message normally.
      return { handled: false, reason: "expired" };
    }

    if (result.status === "rejected" || result.status === "still_missing") {
      await safeSend(
        sendMessageFn,
        chatId,
        result.question || existing.question
      );
      return { handled: true, reason: result.status };
    }

    if (result.status === "complete" && result.draft) {
      const executed = await executeCompletedDraft({
        draft: result.draft,
        chatId,
        from,
        userId,
        inputSource,
        requestKey,
        executeActionsFn,
        addExpenseFn,
        addIncomeFn,
      });

      if (executed.message) {
        await safeSend(sendMessageFn, chatId, executed.message, {
          reply_markup: executed.reply_markup,
        });
      }
      return { handled: true, reason: "completed" };
    }

    return { handled: true, reason: result.status };
  }

  // 2) Incomplete task/memory.
  // Bare "Запомни" clarification is allowed in any AI_ROUTER_MODE (legacy UX).
  // Incomplete task_create remains active-mode only.
  const incomplete = detectIncompleteIntent(text);
  if (incomplete) {
    if (
      incomplete.kind !== "memory_save" &&
      !aiRouterActiveFn()
    ) {
      console.log(
        `[clarification] shadow skip task/memory kind=${incomplete.kind}`
      );
      return { handled: false, reason: "shadow_skip_task_memory" };
    }
    const pending = engine.startFromIncompleteIntent({
      text,
      actorKey,
      chatId,
      requestKey,
    });
    if (pending) {
      console.log(`[clarification] start kind=${pending.kind}`);
      await safeSend(sendMessageFn, chatId, pending.question);
      return { handled: true, reason: "started_incomplete_intent" };
    }
  }

  return { handled: false };
}

/**
 * AI-only needsClarification → ask only in active mode (task/memory).
 */
export async function maybeStartClarificationFromAiDecision(
  input = {},
  options = {}
) {
  const { chatId, text, actor, decision, requestKey = null } = input;
  const {
    engine = defaultClarificationEngine,
    sendMessageFn = defaultSendMessageFn,
    aiRouterActiveFn = isAiRouterExecutionActive,
  } = options;

  if (!aiRouterActiveFn()) {
    if (decision?.needsClarification) {
      console.log("[clarification] shadow skip ai-only plan");
    }
    return { handled: false, reason: "shadow" };
  }

  if (!decision?.needsClarification) {
    return { handled: false, reason: "not_needed" };
  }

  const actorKey = actor?.actorKey || "telegram:unknown";
  if (engine.getPending(actorKey, chatId)) {
    return { handled: false, reason: "already_pending" };
  }

  const pending = engine.startFromAiDecision({
    decision,
    actorKey,
    chatId,
    originalText: text,
    requestKey,
  });

  if (!pending) {
    return { handled: false, reason: "no_supported_draft" };
  }

  console.log(`[clarification] ai-start kind=${pending.kind}`);
  await safeSend(sendMessageFn, chatId, pending.question);
  return { handled: true, reason: "started_from_ai" };
}

/**
 * Incomplete deterministic finance — works in any AI_ROUTER_MODE.
 * Finance remains legacy-owned; AI executor never writes finance.
 */
export async function maybeStartClarificationFromFinanceAttempt(
  input = {},
  options = {}
) {
  const { chatId, text, actor, requestKey = null, parsed = null } = input;

  const {
    engine = defaultClarificationEngine,
    sendMessageFn = defaultSendMessageFn,
    parseFinanceFn = parseFinanceMessage,
  } = options;

  const actorKey = actor?.actorKey || "telegram:unknown";

  if (engine.getPending(actorKey, chatId)) {
    return { handled: false, reason: "already_pending" };
  }

  const finance = parsed ?? parseFinanceFn(text);
  const missing = missingFinanceClarificationFields(finance, text);
  if (!missing || missing.length === 0) {
    return { handled: false, reason: "finance_complete_or_unparsed" };
  }

  const pending = engine.startFromIncompleteFinance({
    text,
    actorKey,
    chatId,
    requestKey,
    parsed: finance,
  });

  if (!pending) {
    return { handled: false, reason: "not_started" };
  }

  console.log(`[clarification] finance-start kind=${pending.kind}`);
  await safeSend(sendMessageFn, chatId, pending.question);
  return { handled: true, reason: "started_finance" };
}

async function executeCompletedDraft({
  draft,
  chatId,
  from,
  userId,
  inputSource,
  requestKey,
  executeActionsFn,
  addExpenseFn,
  addIncomeFn,
}) {
  const type = draft?.type;

  if (type === "task_create" || type === "memory_save") {
    const { results, executedCount } = await executeActionsFn(
      [
        {
          type,
          confidence: 1,
          payload: draft.payload || {},
          requiresConfirmation: false,
        },
      ],
      {
        mode: "active",
        chatId,
        userId: from?.id,
        username: from?.username,
        firstName: from?.first_name,
        inputSource,
        requestKey,
      }
    );

    if (executedCount > 0 && results[0]) {
      const confirmation = formatAiExecutionConfirmation(results[0]);
      if (confirmation && typeof confirmation === "object") {
        return {
          ok: true,
          message: confirmation.text || "✅ Готово.",
          reply_markup: confirmation.reply_markup,
        };
      }
      return { ok: true, message: confirmation || "✅ Готово." };
    }
    return {
      ok: false,
      message: "Не удалось сохранить. Попробуйте ещё раз.",
    };
  }

  if (type === "finance_expense" || type === "finance_income") {
    const payload = draft.payload || {};
    const amount = payload.amount;
    if (!(typeof amount === "number" && Number.isFinite(amount))) {
      return { ok: false, message: "Не удалось распознать сумму." };
    }

    const description = String(payload.description || "").trim();
    const currency = payload.currency || "VND";
    const category =
      payload.category || detectCategory(description) || "other";

    const record =
      type === "finance_income"
        ? await addIncomeFn({
            amount,
            category,
            description,
            currency,
            user_id: userId,
          })
        : await addExpenseFn({
            amount,
            category,
            description,
            currency,
            user_id: userId,
          });

    if (!record) {
      return { ok: false, message: "Не удалось сохранить операцию." };
    }

    const label = type === "finance_income" ? "Доход" : "Расход";
    return {
      ok: true,
      message: `${THIN_CONFIRM.finance}\n\n${THIN_CONFIRM.openFinance}`,
      reply_markup: withMiniAppOpenButton(
        {},
        MINI_APP_PATHS.finance,
        THIN_CONFIRM.openFinance
      ).reply_markup,
      label,
    };
  }

  return { ok: false, message: null };
}

async function safeSend(sendMessageFn, chatId, text, extra) {
  try {
    await sendMessageFn(chatId, text, extra);
  } catch (error) {
    console.error("[clarification] sendMessage failed");
  }
}

/** Test helper */
export function createClarificationRouteDeps(overrides = {}) {
  const engine =
    overrides.engine ||
    createClarificationEngine({ store: overrides.store });
  return { engine, ...overrides };
}
