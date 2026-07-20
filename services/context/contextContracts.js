/**
 * Contracts for Conversation Context + Clarification Engine.
 * Pure data helpers — no Telegram / Supabase / domain writes.
 */

export const CLARIFICATION_KINDS = Object.freeze([
  "task_create",
  "memory_save",
  "finance_expense",
  "finance_income",
]);

/** Exact normalized cancel phrases (D-017). */
export const CANCEL_PHRASES = Object.freeze([
  "отмена",
  "отменить",
  "не надо",
  "cancel",
  "stop",
]);

export const DEFAULT_CLARIFICATION_TTL_MS = 15 * 60 * 1000;

/** Stable finance ask order: currency, then description. */
export const FINANCE_FIELD_ORDER = Object.freeze(["currency", "description"]);

export const QUESTIONS = Object.freeze({
  task_content: "Что нужно сделать?",
  memory_content: "Что нужно запомнить?",
  finance_currency: "В какой валюте была операция?",
  finance_description: "На что были потрачены деньги?",
});

const DESTRUCTIVE_ANSWER_PHRASES = Object.freeze([
  "удалить все знания",
  "удали все знания",
]);

/**
 * @param {string} text
 */
export function isCancelClarificationPhrase(text) {
  const normalized = normalizeAnswerPhrase(text);
  return CANCEL_PHRASES.includes(normalized);
}

/**
 * @param {string} text
 */
export function isDestructiveClarificationAnswer(text) {
  const normalized = normalizeAnswerPhrase(text);
  return DESTRUCTIVE_ANSWER_PHRASES.includes(normalized);
}

/**
 * @param {string} text
 */
export function normalizeAnswerPhrase(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/u, "");
}

/**
 * Explicit currency token in user text (not a parser default).
 * @param {string} text
 */
export function hasExplicitCurrency(text) {
  const t = String(text ?? "");
  return (
    /донг|донга|донгов|vnd|₫/i.test(t) ||
    /тенге|kzt|₸/i.test(t) ||
    /usd|доллар|\$/i.test(t) ||
    /eur|евро|€/i.test(t) ||
    /rub|руб|₽/i.test(t) ||
    /\bthb\b|бат/i.test(t)
  );
}

/**
 * Parse a currency-only clarification answer.
 * @param {string} text
 * @returns {string|null}
 */
export function parseCurrencyAnswer(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (/донг|vnd|₫/i.test(t)) return "VND";
  if (/тенге|kzt|₸/i.test(t)) return "KZT";
  if (/доллар|usd|\$/i.test(t)) return "USD";
  if (/евро|eur|€/i.test(t)) return "EUR";
  if (/руб|rub|₽/i.test(t)) return "RUB";
  if (/бат|thb/i.test(t)) return "THB";
  const bare = t.toUpperCase();
  if (["VND", "USD", "RUB", "THB", "EUR", "KZT"].includes(bare)) return bare;
  return null;
}

/**
 * @param {object} input
 */
export function createPendingClarification(input = {}) {
  const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const ttlMs = Number.isFinite(input.ttlMs)
    ? input.ttlMs
    : DEFAULT_CLARIFICATION_TTL_MS;

  const kind = CLARIFICATION_KINDS.includes(input.kind)
    ? input.kind
    : "task_create";

  const missingFields = Array.isArray(input.missingFields)
    ? input.missingFields.map(String).filter(Boolean)
    : [];

  const question =
    typeof input.question === "string" && input.question.trim()
      ? input.question.trim()
      : questionForMissingFields(kind, missingFields);

  return {
    id: input.id ?? `clar-${now}-${Math.random().toString(36).slice(2, 8)}`,
    actorKey: String(input.actorKey || "telegram:unknown"),
    chatId:
      input.chatId == null || input.chatId === ""
        ? null
        : Number.isFinite(Number(input.chatId))
          ? Number(input.chatId)
          : null,
    kind,
    missingFields,
    question,
    draft:
      input.draft && typeof input.draft === "object"
        ? {
            type: input.draft.type ?? kind,
            payload:
              input.draft.payload && typeof input.draft.payload === "object"
                ? { ...input.draft.payload }
                : {},
          }
        : { type: kind, payload: {} },
    originalText: typeof input.originalText === "string" ? input.originalText : "",
    requestKey: input.requestKey ?? null,
    createdAt: now,
    expiresAt: now + ttlMs,
    status: "pending",
  };
}

/**
 * @param {string} actorKey
 * @param {number|string|null} chatId
 */
export function buildContextKey(actorKey, chatId) {
  const chat =
    chatId == null || chatId === "" ? "unknown" : String(chatId);
  return `${actorKey}::${chat}`;
}

/**
 * Detect incomplete task/memory intents that need clarification.
 * @param {string} text
 * @returns {{ kind: string, missingFields: string[], question: string, draft: object }|null}
 */
export function detectIncompleteIntent(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  const taskExact =
    /^(создай\s+задачу|добавь\s+задачу|новая\s+задача|задача)$/i;
  const taskPrefix = /^(создай\s+задачу|добавь\s+задачу|задача)[:\s]+$/i;
  if (taskExact.test(lower) || taskPrefix.test(trimmed)) {
    return {
      kind: "task_create",
      missingFields: ["content"],
      question: QUESTIONS.task_content,
      draft: { type: "task_create", payload: { content: null } },
    };
  }

  const memoryExact = /^(запомни|запомнить)$/i;
  const memoryPrefix = /^(запомни|запомнить)[:\s]+$/i;
  if (memoryExact.test(lower) || memoryPrefix.test(trimmed)) {
    return {
      kind: "memory_save",
      missingFields: ["content"],
      question: QUESTIONS.memory_content,
      draft: { type: "memory_save", payload: { content: null } },
    };
  }

  const taskWithContent = /^(создай\s+задачу|добавь\s+задачу)\s+(.+)$/i.exec(
    trimmed
  );
  if (taskWithContent && taskWithContent[2].trim()) {
    return null;
  }

  const memoryWithContent = /^(запомни|запомнить)\s+(.+)$/i.exec(trimmed);
  if (memoryWithContent && memoryWithContent[2].trim()) {
    return null;
  }

  return null;
}

/**
 * Next field to ask (one at a time). Finance: currency → description.
 * @param {string} kind
 * @param {string[]} missingFields
 * @returns {string|null}
 */
export function nextMissingField(kind, missingFields = []) {
  const missing = new Set(missingFields);
  if (kind === "finance_expense" || kind === "finance_income") {
    for (const field of FINANCE_FIELD_ORDER) {
      if (missing.has(field)) return field;
    }
    return null;
  }
  if (missing.has("content")) return "content";
  return missingFields[0] ?? null;
}

/**
 * Deterministic field-based question (no LLM).
 * @param {string} kind
 * @param {string[]} missingFields
 */
export function questionForMissingFields(kind, missingFields = []) {
  const field = nextMissingField(kind, missingFields);
  if (kind === "task_create" && field === "content") {
    return QUESTIONS.task_content;
  }
  if (kind === "memory_save" && field === "content") {
    return QUESTIONS.memory_content;
  }
  if (
    (kind === "finance_expense" || kind === "finance_income") &&
    field === "currency"
  ) {
    return QUESTIONS.finance_currency;
  }
  if (
    (kind === "finance_expense" || kind === "finance_income") &&
    field === "description"
  ) {
    return QUESTIONS.finance_description;
  }
  return QUESTIONS.task_content;
}

/**
 * Missing fields for a draft action.
 * Finance: currency/description only (amount already known). Currency is
 * missing when not explicitly stated by the user (parser defaults ignored).
 *
 * @param {{ type?: string, payload?: object }|null} action
 * @param {{ originalText?: string, requireExplicitCurrency?: boolean }} [opts]
 */
export function missingFieldsForAction(action, opts = {}) {
  if (!action?.type) return ["content"];
  const payload =
    action.payload && typeof action.payload === "object" ? action.payload : {};

  if (action.type === "task_create") {
    const content = String(payload.content ?? "").trim();
    return content ? [] : ["content"];
  }
  if (action.type === "memory_save") {
    const content = String(payload.content ?? "").trim();
    return content ? [] : ["content"];
  }
  if (action.type === "finance_expense" || action.type === "finance_income") {
    const missing = [];
    const requireExplicit =
      opts.requireExplicitCurrency !== false &&
      typeof opts.originalText === "string";
    const currencyOk = requireExplicit
      ? hasExplicitCurrency(opts.originalText) ||
        (payload.currencyExplicit === true &&
          typeof payload.currency === "string" &&
          payload.currency)
      : Boolean(payload.currency);
    if (!currencyOk) missing.push("currency");
    if (!String(payload.description ?? "").trim()) missing.push("description");
    return missing;
  }
  return [];
}

/**
 * Build finance missing-field list from a parsed finance row + original text.
 * @param {object|null} parsed
 * @param {string} originalText
 */
export function missingFinanceClarificationFields(parsed, originalText) {
  if (!parsed || !(typeof parsed.amount === "number" && Number.isFinite(parsed.amount))) {
    return null;
  }
  return missingFieldsForAction(
    {
      type: parsed.type === "income" ? "finance_income" : "finance_expense",
      payload: {
        amount: parsed.amount,
        currency: parsed.currency,
        description: parsed.description,
        currencyExplicit: hasExplicitCurrency(originalText),
      },
    },
    { originalText, requireExplicitCurrency: true }
  );
}
