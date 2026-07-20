import { AI_ROUTER_CHEAP_MODEL, AI_ROUTER_MAX_ACTIONS } from "../../config/aiRouter.js";
import { ACTION_TYPES, LANGUAGES } from "./contracts.js";

// Tier 1 ("cheap analyzer"): calls a compact model to semantically
// classify a message the deterministic detector could not confidently
// handle. Never calls Telegram/Supabase/Finance/Memory/Tasks/Knowledge —
// only builds a prompt and asks an injected PlannerProvider for a
// structured decision.

function buildSystemPrompt(maxActions) {
  return `You are the Intent Analyzer inside ALMAS, a personal assistant bot.
You receive one Telegram message (typed or voice-transcribed) in Russian, English, Kazakh, or a mix, possibly with speech-recognition mistakes.

Your job: classify the message into a strict JSON object, never free text.

Allowed action "type" values (use exactly one of these, never invent a new one):
${ACTION_TYPES.join(", ")}

Allowed "language" values: ${LANGUAGES.join(", ")}

Rules:
- Extract at most ${maxActions} actions, in the same order they appear in the message.
- Only use fields you can actually read from the message. Never invent amounts, currencies, dates, names, or commands that are not present.
- If an amount is unclear, low-confidence, or missing for a finance action, still return the action but set a low "confidence" and set "needsClarification": true with a short question.
- If the message asks to delete/remove/удалить anything, or looks destructive/irreversible, use "system_command" and set "requiresConfirmation": true. Never mark a destructive action as safe to run automatically.
- If you cannot determine any safe action, return an empty "actions" array, set "needsClarification": true, and ask one short, concrete clarification question in the same language as the message.
- Set "shouldEscalate": true only if the message truly needs a stronger model (multiple actions with unclear relationships, ambiguous dates, long/context-dependent input) — not for every message.
- "reasonCode" is a short machine-readable label for why you decided what you decided (e.g. "clear_expense", "ambiguous_amount", "multi_action", "no_actionable_intent").
- Output must match the provided JSON schema exactly. Do not add extra fields.`;
}

function buildUserPrompt(normalizedText) {
  return `Message:\n"""\n${normalizedText}\n"""`;
}

/**
 * Runs Tier 1 (cheap model) intent analysis.
 *
 * @param {{ normalized: string, original: string, inputSource: string }} input
 * @param {object} [options]
 * @param {import("../../providers/ai/plannerProvider.js").PlannerProvider} options.provider - required, injected by the caller (never constructed here).
 * @param {string} [options.model]
 * @param {number} [options.maxActions]
 * @returns {Promise<{ ok: boolean, tier: "cheap", contract: object|null, reason?: string, usage: object|null }>}
 */
export async function analyzeIntent(input, options = {}) {
  const {
    provider,
    model = AI_ROUTER_CHEAP_MODEL,
    maxActions = AI_ROUTER_MAX_ACTIONS,
  } = options;

  if (!provider) {
    return { ok: false, tier: "cheap", contract: null, reason: "no_provider", usage: null };
  }

  const systemPrompt = buildSystemPrompt(maxActions);
  const userPrompt = buildUserPrompt(input.normalized);

  let response;

  try {
    response = await provider.run({ systemPrompt, userPrompt }, { model });
  } catch (error) {
    return { ok: false, tier: "cheap", contract: null, reason: "provider_threw", usage: null };
  }

  if (!response?.ok || !response.result || !Array.isArray(response.result.actions)) {
    return {
      ok: false,
      tier: "cheap",
      contract: null,
      reason: response?.reason || "invalid_response",
      usage: response?.usage || null,
    };
  }

  return { ok: true, tier: "cheap", contract: response.result, usage: response.usage || null };
}
