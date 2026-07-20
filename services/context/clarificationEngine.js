/**
 * Clarification Engine — multi-turn completion for incomplete
 * task_create, memory_save, and incomplete finance drafts.
 *
 * Merge/validate + store orchestration only. Telegram sends / domain
 * writes live in handlers/routes/clarificationRoute.js.
 */

import {
  parseFinanceMessage,
  looksLikeFinanceAttempt,
} from "../finance/financeParser.js";
import { isMeaninglessShortInput } from "../../core/utils/isMeaninglessShortInput.js";
import {
  createPendingClarification,
  detectIncompleteIntent,
  hasExplicitCurrency,
  isCancelClarificationPhrase,
  isDestructiveClarificationAnswer,
  missingFieldsForAction,
  missingFinanceClarificationFields,
  nextMissingField,
  parseCurrencyAnswer,
  questionForMissingFields,
} from "./contextContracts.js";
import { defaultConversationContextStore } from "./conversationContextStore.js";

/**
 * @param {object} [deps]
 */
export function createClarificationEngine(deps = {}) {
  const store = deps.store ?? defaultConversationContextStore;
  const nowFn = deps.nowFn ?? (() => Date.now());
  const parseFinanceFn = deps.parseFinanceFn ?? parseFinanceMessage;
  const looksLikeFinanceFn = deps.looksLikeFinanceFn ?? looksLikeFinanceAttempt;

  function getPending(actorKey, chatId) {
    return store.get(actorKey, chatId, nowFn());
  }

  function start(input = {}) {
    const pending = createPendingClarification({
      ...input,
      nowMs: nowFn(),
      question:
        input.question ||
        questionForMissingFields(input.kind, input.missingFields || []),
    });
    store.set(pending);
    return pending;
  }

  function clear(actorKey, chatId) {
    store.clear(actorKey, chatId);
  }

  function startFromIncompleteIntent({
    text,
    actorKey,
    chatId,
    requestKey = null,
  }) {
    const detected = detectIncompleteIntent(text);
    if (!detected) return null;
    return start({
      actorKey,
      chatId,
      kind: detected.kind,
      missingFields: detected.missingFields,
      question: detected.question,
      draft: detected.draft,
      originalText: text,
      requestKey,
    });
  }

  function startFromAiDecision({
    decision,
    actorKey,
    chatId,
    originalText,
    requestKey = null,
  }) {
    if (!decision?.needsClarification) return null;

    const actions = Array.isArray(decision.actions) ? decision.actions : [];
    const rejected = Array.isArray(decision.rejectedActions)
      ? decision.rejectedActions
      : [];

    let candidate =
      actions.find(
        (a) => a?.type === "task_create" || a?.type === "memory_save"
      ) ?? null;

    if (!candidate) {
      const rejectedAction = rejected.find(
        (r) =>
          r?.action?.type === "task_create" ||
          r?.action?.type === "memory_save"
      );
      candidate = rejectedAction?.action ?? null;
    }

    if (!candidate) {
      return startFromIncompleteIntent({
        text: originalText,
        actorKey,
        chatId,
        requestKey,
      });
    }

    const missing = missingFieldsForAction(candidate);
    if (missing.length === 0) return null;

    const kind = candidate.type;
    return start({
      actorKey,
      chatId,
      kind,
      missingFields: missing,
      question: questionForMissingFields(kind, missing),
      draft: {
        type: kind,
        payload: { ...(candidate.payload || {}) },
      },
      originalText,
      requestKey,
    });
  }

  /**
   * Incomplete finance: parsed amount present but currency and/or
   * description missing (currency must be explicit in original text).
   */
  function startFromIncompleteFinance({
    text,
    actorKey,
    chatId,
    requestKey = null,
    parsed = null,
  }) {
    const finance = parsed || parseFinanceFn(text);
    if (!finance) {
      // Truly unparsed attempt: cannot clarify currency/description without amount.
      if (looksLikeFinanceFn(text)) {
        return null;
      }
      return null;
    }

    const missing = missingFinanceClarificationFields(finance, text);
    if (!missing || missing.length === 0) return null;

    const kind =
      finance.type === "income" ? "finance_income" : "finance_expense";

    return start({
      actorKey,
      chatId,
      kind,
      missingFields: missing,
      question: questionForMissingFields(kind, missing),
      draft: {
        type: kind,
        payload: {
          amount: finance.amount,
          // Do not carry parser default currency unless user stated it.
          currency: hasExplicitCurrency(text) ? finance.currency : null,
          currencyExplicit: hasExplicitCurrency(text),
          description: String(finance.description || "").trim(),
          category: finance.category || null,
        },
      },
      originalText: text,
      requestKey,
    });
  }

  /**
   * @returns {{
   *   status: 'cancelled'|'expired'|'rejected'|'still_missing'|'complete'|'duplicate',
   *   pending: object|null,
   *   draft: object|null,
   *   question: string|null,
   * }}
   */
  function handleAnswer({ actorKey, chatId, answerText, requestKey = null }) {
    const now = nowFn();

    if (requestKey && store.hasProcessedRequestKey(requestKey)) {
      return {
        status: "duplicate",
        pending: null,
        draft: null,
        question: null,
      };
    }

    const pending = store.get(actorKey, chatId, now);
    if (!pending) {
      return {
        status: "expired",
        pending: null,
        draft: null,
        question: null,
      };
    }

    if (isCancelClarificationPhrase(answerText)) {
      store.clear(actorKey, chatId);
      return {
        status: "cancelled",
        pending,
        draft: null,
        question: null,
      };
    }

    if (isDestructiveClarificationAnswer(answerText)) {
      return {
        status: "rejected",
        pending,
        draft: pending.draft,
        question: pending.question,
      };
    }

    if (isMeaninglessShortInput(answerText)) {
      return {
        status: "rejected",
        pending,
        draft: pending.draft,
        question: pending.question,
      };
    }

    const trimmed = String(answerText ?? "").trim();
    if (!trimmed) {
      return {
        status: "still_missing",
        pending,
        draft: pending.draft,
        question: pending.question,
      };
    }

    const merged = mergeIntoDraft(pending, trimmed);
    const missingAfter = missingFieldsForAction(
      {
        type: merged.draft.type,
        payload: merged.draft.payload,
      },
      {
        originalText: pending.originalText,
        requireExplicitCurrency: !merged.draft.payload?.currencyExplicit,
      }
    );

    if (missingAfter.length === 0) {
      store.clear(actorKey, chatId);
      if (requestKey) store.markProcessedRequestKey(requestKey, now);
      return {
        status: "complete",
        pending: { ...pending, draft: merged.draft, missingFields: [] },
        draft: merged.draft,
        question: null,
      };
    }

    const question = questionForMissingFields(merged.kind, missingAfter);
    const updated = store.update(actorKey, chatId, {
      kind: merged.kind,
      draft: merged.draft,
      missingFields: missingAfter,
      question,
    }, now);

    return {
      status: "still_missing",
      pending: updated,
      draft: updated?.draft ?? merged.draft,
      question,
    };
  }

  return {
    getPending,
    start,
    clear,
    startFromIncompleteIntent,
    startFromAiDecision,
    startFromIncompleteFinance,
    handleAnswer,
    store,
  };
}

function mergeIntoDraft(pending, answer) {
  const kind = pending.kind;
  const payload = { ...(pending.draft?.payload || {}) };

  if (kind === "task_create") {
    if (!String(payload.content ?? "").trim()) {
      payload.content = answer;
    } else {
      // Unresolved temporal phrase only — do not invent ISO datetime.
      payload.unresolvedTemporal = answer.trim();
    }
    return { kind, draft: { type: "task_create", payload } };
  }

  if (kind === "memory_save") {
    if (!String(payload.content ?? "").trim()) {
      payload.content = answer;
    } else {
      payload.content = `${payload.content} ${answer}`.trim();
    }
    return { kind, draft: { type: "memory_save", payload } };
  }

  // Finance — field-at-a-time merge (currency → description).
  const missing = missingFieldsForAction(
    { type: kind, payload },
    {
      originalText: pending.originalText,
      requireExplicitCurrency: !payload.currencyExplicit,
    }
  );
  const field = nextMissingField(kind, missing);

  if (field === "currency") {
    const currency = parseCurrencyAnswer(answer);
    if (currency) {
      payload.currency = currency;
      payload.currencyExplicit = true;
    }
    return { kind, draft: { type: kind, payload } };
  }

  if (field === "description") {
    payload.description = answer.trim();
    return { kind, draft: { type: kind, payload } };
  }

  return { kind, draft: { type: kind, payload } };
}

/** Process-local default engine. */
export const defaultClarificationEngine = createClarificationEngine();
