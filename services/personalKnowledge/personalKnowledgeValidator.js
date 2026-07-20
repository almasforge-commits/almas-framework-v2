/**
 * Personal Knowledge validator — reject unsafe / ungrounded / world facts.
 * Pure. No Telegram / Supabase / execution imports.
 */

import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import {
  REJECT_REASONS,
  isWritablePersonalDomain,
  normalizePersonalContent,
} from "./personalKnowledgeContracts.js";
import { looksLikeWorldOrGeneralKnowledge } from "./personalKnowledgeClassifier.js";

const DESTRUCTIVE_PHRASES = Object.freeze([
  "удалить все знания",
  "удали все знания",
  "delete all knowledge",
  "delete last transaction",
  "удалить последнюю транзакцию",
]);

/**
 * @param {object} input
 * @param {object} [options]
 * @returns {{ ok: true }|{ ok: false, reason: string }}
 */
export function validatePersonalIngest(input = {}, options = {}) {
  const threshold = Number.isFinite(options.confidenceThreshold)
    ? options.confidenceThreshold
    : 0.7;

  const actorKey = String(input.actorKey ?? "").trim();
  if (!actorKey) {
    return { ok: false, reason: REJECT_REASONS.MISSING_ACTOR };
  }

  const text = String(input.text ?? input.content ?? "").trim();
  if (!text) {
    return { ok: false, reason: REJECT_REASONS.EMPTY_INPUT };
  }

  if (isMenuNavigationCommand(text)) {
    return { ok: false, reason: REJECT_REASONS.MENU_LABEL };
  }

  const normalized = normalizePersonalContent(text);
  if (DESTRUCTIVE_PHRASES.includes(normalized)) {
    return { ok: false, reason: REJECT_REASONS.DESTRUCTIVE_COMMAND };
  }

  if (looksLikeWorldOrGeneralKnowledge(text) || input.scope === "world") {
    return { ok: false, reason: REJECT_REASONS.WORLD_OR_GENERAL };
  }

  if (input.domain === "Timeline") {
    return { ok: false, reason: REJECT_REASONS.TIMELINE_WRITE };
  }

  if (input.domain != null && !isWritablePersonalDomain(input.domain)) {
    return { ok: false, reason: REJECT_REASONS.UNSUPPORTED_DOMAIN };
  }

  if (isFinanceExecutionPayload(input)) {
    return { ok: false, reason: REJECT_REASONS.FINANCE_EXECUTION_PAYLOAD };
  }

  if (input.evidence !== undefined && input.evidence !== null) {
    if (typeof input.evidence !== "object" || Array.isArray(input.evidence)) {
      return { ok: false, reason: REJECT_REASONS.MALFORMED_EVIDENCE };
    }
  }

  // Must be grounded in user text or an explicitly personal extracted candidate.
  const grounded =
    input.sourceType === "user_text" ||
    input.sourceType === "user_voice" ||
    input.sourceType === "manual" ||
    (input.sourceType === "extraction_candidate" &&
      input.candidate?.kind &&
      mapAllowsPersonal(input.candidate.kind));

  if (input.requireGrounding !== false && input.sourceType === "extraction_candidate") {
    if (!input.candidate?.kind || !mapAllowsPersonal(input.candidate.kind)) {
      return { ok: false, reason: REJECT_REASONS.NOT_GROUNDED };
    }
  }

  // If caller marked ungrounded explicitly
  if (input.grounded === false) {
    return { ok: false, reason: REJECT_REASONS.NOT_GROUNDED };
  }

  void grounded;

  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < threshold) {
    return { ok: false, reason: REJECT_REASONS.LOW_CONFIDENCE };
  }

  if (!input.domain) {
    return { ok: false, reason: REJECT_REASONS.UNSUPPORTED_DOMAIN };
  }

  return { ok: true };
}

function mapAllowsPersonal(kind) {
  const allowed = new Set([
    "memory",
    "goal",
    "decision",
    "contact",
    "idea",
    "health",
    "project",
    "finance",
    "task",
    "knowledge",
  ]);
  return allowed.has(String(kind).toLowerCase());
}

/**
 * Detect finance write payloads that must not be stored as PK facts here.
 * Classification of finance *mentions* is allowed; execution shapes are not.
 */
function isFinanceExecutionPayload(input) {
  const payload = input.payload ?? input.financePayload;
  if (!payload || typeof payload !== "object") return false;
  const hasAmount =
    typeof payload.amount === "number" && Number.isFinite(payload.amount);
  const hasType =
    payload.type === "expense" ||
    payload.type === "income" ||
    input.actionType === "finance_expense" ||
    input.actionType === "finance_income";
  return hasAmount && hasType && input.executeFinance === true;
}
