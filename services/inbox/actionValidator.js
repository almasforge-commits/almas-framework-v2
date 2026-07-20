import {
  ACTION_TYPES,
  LANGUAGES,
  PAYLOAD_FIELDS,
  isDestructiveAction,
  canonicalizeActionPayload,
} from "./contracts.js";
import { AI_ROUTER_MAX_ACTIONS, AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD } from "../../config/aiRouter.js";

// Deterministic Safety Validator. This is the ONLY place that decides
// whether an AI-produced action is allowed to be treated as valid.
// Input is untrusted (comes from an AI provider) — every field is
// re-checked; nothing here trusts the AI's own confidence/flags at face
// value. This module makes decisions only; it never calls a domain
// service and never executes anything.

const FALLBACK_CLARIFICATION_QUESTION =
  "Не удалось точно понять запрос. Уточните, пожалуйста, что нужно сделать?";

function sanitizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(1, Math.max(0, num));
}

function sanitizePayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const sanitized = {};
  for (const field of PAYLOAD_FIELDS) {
    sanitized[field] = field in source ? source[field] ?? null : null;
  }
  return sanitized;
}

function payloadSignature(type, payload) {
  const sortedEntries = PAYLOAD_FIELDS.map((field) => [field, payload[field] ?? null]);
  return `${type}::${JSON.stringify(sortedEntries)}`;
}

/**
 * Validates and sanitizes a raw routing contract (as produced by a
 * PlannerProvider, or by the deterministic detector) into a safe
 * decision. Never throws — malformed input degrades to rejected actions
 * plus a clarification request, never a crash.
 *
 * @param {object} rawContract - untrusted, see contracts.js for shape.
 * @param {{ inputSource: "text"|"voice", maxActions?: number, confidenceThreshold?: number }} context
 * @returns {{
 *   language: string,
 *   actions: object[],
 *   rejectedActions: { action: object, reason: string }[],
 *   needsClarification: boolean,
 *   clarificationQuestion: string|null,
 *   shouldEscalate: boolean,
 *   reasonCode: string,
 *   wouldExecute: boolean,
 * }}
 */
export function validateRoutingContract(rawContract, context = {}) {
  const {
    inputSource = "text",
    maxActions = AI_ROUTER_MAX_ACTIONS,
    confidenceThreshold = AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD,
  } = context;

  const source = rawContract && typeof rawContract === "object" ? rawContract : {};

  const language = LANGUAGES.includes(source.language) ? source.language : "unknown";
  const reasonCode =
    typeof source.reasonCode === "string" && source.reasonCode.trim()
      ? source.reasonCode
      : "unspecified";

  const rawActions = Array.isArray(source.actions) ? source.actions : [];

  const rejectedActions = [];
  const validActions = [];
  const seenSignatures = new Set();
  let forceClarification = Boolean(source.needsClarification);

  rawActions.forEach((rawAction, index) => {
    if (validActions.length >= maxActions) {
      rejectedActions.push({ action: rawAction, reason: "max_actions_exceeded" });
      return;
    }

    const type = rawAction?.type;

    if (!ACTION_TYPES.includes(type)) {
      rejectedActions.push({ action: rawAction, reason: "unknown_action_type" });
      return;
    }

    const confidence = sanitizeConfidence(rawAction.confidence);
    // Fold supported aliases (e.g. task payload.title/text → content)
    // BEFORE sanitizePayload strips unknown keys — otherwise a valid
    // medium-tier task that used `title` would lose its description and
    // later be skipped as missing_content.
    const payload = sanitizePayload(canonicalizeActionPayload(type, rawAction.payload));

    const action = {
      type,
      confidence,
      payload,
      requiresConfirmation: Boolean(rawAction.requiresConfirmation),
    };

    if (isDestructiveAction(action)) {
      action.requiresConfirmation = true;

      // "Voice may never directly execute destructive actions" — reject
      // outright for voice input rather than merely flagging it, so a
      // future executor can never be tricked into treating it as safe.
      if (inputSource === "voice") {
        rejectedActions.push({ action, reason: "voice_destructive_blocked" });
        return;
      }
    }

    const isFinanceAction = type === "finance_expense" || type === "finance_income";
    const hasAmount = typeof payload.amount === "number" && Number.isFinite(payload.amount);

    if (isFinanceAction && (!hasAmount || confidence < confidenceThreshold)) {
      rejectedActions.push({
        action,
        reason: !hasAmount ? "missing_amount" : "low_confidence_amount",
      });
      forceClarification = true;
      return;
    }

    const signature = payloadSignature(type, payload);

    if (seenSignatures.has(signature)) {
      rejectedActions.push({ action, reason: "duplicate_action" });
      return;
    }

    seenSignatures.add(signature);
    validActions.push(action);
  });

  let clarificationQuestion =
    typeof source.clarificationQuestion === "string" && source.clarificationQuestion.trim()
      ? source.clarificationQuestion.trim()
      : null;

  const needsClarification = Boolean(
    forceClarification || validActions.length === 0
  );

  if (needsClarification && !clarificationQuestion) {
    clarificationQuestion = FALLBACK_CLARIFICATION_QUESTION;
  }

  if (!needsClarification) {
    clarificationQuestion = null;
  }

  const hasUnresolvedConfirmation = validActions.some((action) => action.requiresConfirmation);
  const wouldExecute = !needsClarification && validActions.length > 0 && !hasUnresolvedConfirmation;

  return {
    language,
    actions: validActions,
    rejectedActions,
    needsClarification,
    clarificationQuestion,
    shouldEscalate: Boolean(source.shouldEscalate),
    reasonCode,
    wouldExecute,
  };
}
