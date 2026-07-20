/**
 * Question gate for Answer Engine Telegram path.
 * Reuses detectDeterministicIntent — does not invent a new classifier.
 */

import { detectDeterministicIntent } from "../inbox/deterministicIntentDetector.js";
import { extractLegacyMemorySaveContent } from "../storage/memoryFilter.js";

const READ_ONLY_TYPES = new Set(["chat", "search"]);

/** Unicode-safe question tokens (Cyrillic + Latin). No JS \\b on Cyrillic. */
const QUESTION_TOKENS = new Set([
  "что",
  "как",
  "какие",
  "какой",
  "какая",
  "какое",
  "когда",
  "где",
  "почему",
  "зачем",
  "сколько",
  "расскажи",
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
  "which",
]);

const MULTIWORD_QUESTION_HINTS = [
  /^tell\s+me\b/i,
  /\bdo\s+you\s+know\b/i,
  /\bwhat\s+do\s+you\s+know\b/i,
  /\bwhat\s+did\s+i\b/i,
  /\bwhat\s+am\s+i\b/i,
  /\bwhat\s+projects\b/i,
  /\bwhat\s+ideas\b/i,
];

const PREFIX_STRIP = [
  { prefix: "спроси ", type: "chat" },
  { prefix: "найди ", type: "search" },
  { prefix: "найти ", type: "search" },
  { prefix: "вспомни ", type: "search" },
];

/**
 * Normalize text into tokens using Unicode letter/number boundaries.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeQuestionText(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Unicode-safe open-question detector (replaces Cyrillic-unsafe \\b regex).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeOpenQuestion(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  for (const re of MULTIWORD_QUESTION_HINTS) {
    if (re.test(trimmed)) return true;
  }
  const tokens = tokenizeQuestionText(trimmed);
  return tokens.some((t) => QUESTION_TOKENS.has(t));
}

/**
 * Classify whether Telegram text should use the read-only Answer Engine.
 * Execution, navigation, and exact commands return useAnswerEngine=false.
 *
 * @param {string} text
 * @param {object} [deps]
 * @param {Function} [deps.detectIntentFn]
 * @returns {{ useAnswerEngine: boolean, reason: string, query: string|null, actionType: string|null }}
 */
export function classifyAnswerRouteIntent(text, deps = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return {
      useAnswerEngine: false,
      reason: "empty",
      query: null,
      actionType: null,
    };
  }

  // Explicit memory-save commands are never questions.
  const memoryCmd = extractLegacyMemorySaveContent(trimmed);
  if (memoryCmd.kind === "save" || memoryCmd.kind === "incomplete") {
    return {
      useAnswerEngine: false,
      reason: "memory_save_command",
      query: null,
      actionType: "memory_save",
    };
  }

  const detectFn = deps.detectIntentFn ?? detectDeterministicIntent;
  const contract = detectFn(trimmed);

  if (contract?.needsClarification === true) {
    return {
      useAnswerEngine: false,
      reason: "needs_clarification_elsewhere",
      query: null,
      actionType: null,
    };
  }

  if (contract && Array.isArray(contract.actions) && contract.actions.length) {
    const action = contract.actions[0];
    const type = action?.type;
    const reasonCode = contract.reasonCode;

    if (
      reasonCode === "youtube_link" ||
      reasonCode === "menu_navigation" ||
      reasonCode === "destructive_command" ||
      reasonCode === "finance_query_intent" ||
      reasonCode === "exact_command" ||
      reasonCode === "finance_parsed" ||
      reasonCode === "meaningless_short_input" ||
      reasonCode === "empty_input"
    ) {
      return {
        useAnswerEngine: false,
        reason: reasonCode || "command",
        query: null,
        actionType: type || null,
      };
    }

    if (type === "finance_expense" || type === "finance_income") {
      return {
        useAnswerEngine: false,
        reason: "execution",
        query: null,
        actionType: type,
      };
    }

    if (type === "system_command" || type === "task_create" || type === "memory_save") {
      return {
        useAnswerEngine: false,
        reason: "execution_or_command",
        query: null,
        actionType: type,
      };
    }

    // knowledge_query covers "открыть"/"покажи" — keep existing handlers.
    if (type === "knowledge_query") {
      return {
        useAnswerEngine: false,
        reason: "knowledge_command",
        query: null,
        actionType: type,
      };
    }

    if (READ_ONLY_TYPES.has(type)) {
      const query =
        (action.payload && action.payload.query) ||
        stripReadOnlyPrefix(trimmed) ||
        trimmed;
      return {
        useAnswerEngine: true,
        reason: "readonly_prefix",
        query: String(query).trim() || trimmed,
        actionType: type,
      };
    }

    if (type === "unknown") {
      return {
        useAnswerEngine: false,
        reason: "unknown",
        query: null,
        actionType: type,
      };
    }
  }

  // Detector returned null (escalate) or unrecognized — only open questions.
  if (looksLikeOpenQuestion(trimmed)) {
    return {
      useAnswerEngine: true,
      reason: "question_pattern",
      query: trimmed,
      actionType: "chat",
    };
  }

  return {
    useAnswerEngine: false,
    reason: "not_question",
    query: null,
    actionType: null,
  };
}

function stripReadOnlyPrefix(text) {
  const lower = String(text).toLowerCase();
  for (const { prefix } of PREFIX_STRIP) {
    if (lower.startsWith(prefix)) {
      return String(text).slice(prefix.length).trim();
    }
  }
  return null;
}
