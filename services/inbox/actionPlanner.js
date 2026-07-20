import { AI_ROUTER_MEDIUM_MODEL, AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD, AI_ROUTER_MAX_ACTIONS } from "../../config/aiRouter.js";
import { ACTION_TYPES, LANGUAGES, canonicalizeActionPayload } from "./contracts.js";

// Tier 2 ("medium planner"): only invoked when Tier 1 is insufficient.
// Same safety boundary as aiIntentAnalyzer.js — no Telegram/Supabase/
// domain-service imports, only prompting + an injected PlannerProvider.

const LONG_INPUT_CHAR_THRESHOLD = 220;

// Required payload entity per action type, used only to decide whether
// Tier 1's own output is complete enough to trust — never to decide
// what a *validated* action needs (that's actionValidator.js's job).
const REQUIRED_ENTITY_BY_TYPE = {
  finance_expense: "amount",
  finance_income: "amount",
  task_create: "content",
  memory_save: "content",
  knowledge_query: "query",
  search: "query",
  chat: "query",
  system_command: "command",
};

function isMalformedAction(action) {
  return (
    !action ||
    typeof action !== "object" ||
    !ACTION_TYPES.includes(action.type) ||
    typeof action.confidence !== "number" ||
    !action.payload ||
    typeof action.payload !== "object"
  );
}

function isMissingRequiredEntity(action) {
  const requiredField = REQUIRED_ENTITY_BY_TYPE[action.type];
  if (!requiredField) return false;
  // Check the canonicalized payload so a medium/cheap model that put the
  // task description in `title`/`text` is not treated as "missing content"
  // and needlessly escalated (or later skipped).
  const payload = canonicalizeActionPayload(action.type, action.payload);
  const value = payload?.[requiredField];
  return value === null || value === undefined || value === "";
}

/**
 * Pure decision: does this message need the medium tier? Multiple
 * actions alone is NOT a reason to escalate — a confident, complete
 * multi-action plan from Tier 1 is accepted as-is. Escalates only for:
 * a malformed contract, an unknown/missing-shape action, a missing
 * required entity (never guessed), Tier 1's own explicit ambiguity
 * signal (`needsClarification`/`shouldEscalate`), low confidence on any
 * action, or unusually long/context-dependent input. A Tier 1 provider
 * failure is handled as a deterministic fallback, not an escalation —
 * calling a second, more expensive model after the first one already
 * failed would not fix a provider outage and doubles cost.
 *
 * @param {{ ok: boolean, contract: object|null }} cheapResult - Tier 1 result.
 * @param {{ normalized: string }} input
 * @param {{ confidenceThreshold?: number }} [options]
 * @returns {boolean}
 */
export function shouldEscalateToMediumTier(cheapResult, input, options = {}) {
  const { confidenceThreshold = AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD } = options;

  if (!cheapResult?.ok || !cheapResult.contract) return false;

  const contract = cheapResult.contract;

  if (!Array.isArray(contract.actions)) return true;

  const actions = contract.actions;

  if (actions.some(isMalformedAction)) return true;

  // Tier 1's own explicit signals: ambiguity it flagged itself, or a
  // direct request for a stronger model (e.g. unresolved relative
  // dates/relationships it couldn't safely reason about).
  if (contract.needsClarification === true) return true;
  if (contract.shouldEscalate === true) return true;

  if (actions.some(isMissingRequiredEntity)) return true;

  const lowestConfidence = actions.reduce(
    (min, action) => Math.min(min, Number(action?.confidence ?? 0)),
    1
  );

  if (actions.length > 0 && lowestConfidence < confidenceThreshold) return true;

  if (String(input?.normalized ?? "").length > LONG_INPUT_CHAR_THRESHOLD) return true;

  return false;
}

function buildSystemPrompt(maxActions) {
  return `You are the Action Planner inside ALMAS, a personal assistant bot.
A cheaper first-pass model already looked at this message and could not confidently resolve it (multiple actions, ambiguous amount/date, low confidence, or a long/context-dependent message).

Re-analyze the message carefully and return the same strict JSON contract.

Allowed action "type" values (never invent a new one): ${ACTION_TYPES.join(", ")}
Allowed "language" values: ${LANGUAGES.join(", ")}

Rules:
- Extract at most ${maxActions} actions, preserving their original order in the message.
- Never invent amounts, currencies, dates, names, or commands that are not clearly present in the message.
- Resolve relative dates/relationships only if they are unambiguous from the message itself; otherwise keep "needsClarification": true with a concrete question.
- Destructive or irreversible requests must use "system_command" with "requiresConfirmation": true — never mark them safe to auto-run.
- If, after careful re-analysis, no safe action can be determined, return an empty "actions" array and a single concise clarification question.
- Output must match the provided JSON schema exactly, with no extra fields.`;
}

function buildUserPrompt(normalizedText, cheapContract) {
  return `Message:\n"""\n${normalizedText}\n"""\n\nFirst-pass (lower-confidence) analysis for reference only — verify it, do not blindly repeat it:\n${JSON.stringify(cheapContract)}`;
}

/**
 * Runs Tier 2 (medium model) planning. Called at most once per message —
 * the caller (routingDecisionService.js) is responsible for ensuring
 * this isn't invoked more than once.
 *
 * @param {{ normalized: string }} input
 * @param {object} [options]
 * @param {import("../../providers/ai/plannerProvider.js").PlannerProvider} options.provider - required.
 * @param {object|null} [options.cheapContract] - Tier 1's contract, passed for context only.
 * @param {string} [options.model]
 * @param {number} [options.maxActions]
 * @returns {Promise<{ ok: boolean, tier: "medium", contract: object|null, reason?: string, usage: object|null }>}
 */
export async function planWithMediumTier(input, options = {}) {
  const {
    provider,
    cheapContract = null,
    model = AI_ROUTER_MEDIUM_MODEL,
    maxActions = AI_ROUTER_MAX_ACTIONS,
  } = options;

  if (!provider) {
    return { ok: false, tier: "medium", contract: null, reason: "no_provider", usage: null };
  }

  const systemPrompt = buildSystemPrompt(maxActions);
  const userPrompt = buildUserPrompt(input.normalized, cheapContract);

  let response;

  try {
    response = await provider.run({ systemPrompt, userPrompt }, { model });
  } catch (error) {
    return { ok: false, tier: "medium", contract: null, reason: "provider_threw", usage: null };
  }

  if (!response?.ok || !response.result || !Array.isArray(response.result.actions)) {
    return {
      ok: false,
      tier: "medium",
      contract: null,
      reason: response?.reason || "invalid_response",
      usage: response?.usage || null,
    };
  }

  return { ok: true, tier: "medium", contract: response.result, usage: response.usage || null };
}
