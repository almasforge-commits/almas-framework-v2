// Provider-neutral contract for the AI Intent Analyzer / Action Planner.
// Any concrete provider (OpenAI today, Kimi or another vendor later)
// must return this exact shape from run(). This file and every other
// module under providers/ai/ must NEVER import Telegram, Supabase, or
// any Finance/Memory/Tasks/Knowledge service — only generic AI-client
// and JSON-parsing concerns belong in this layer.
//
// @typedef {object} PlannerRunResult
// @property {boolean} ok
// @property {object|null} result - parsed routing contract JSON (see
//   services/inbox/contracts.js), or null when !ok.
// @property {string} [reason] - present when !ok, e.g. "no_api_key",
//   "parse_error", "provider_error", "timeout".
// @property {object} usage - { model, latencyMs, promptChars,
//   outputChars, tokenUsage } — tokenUsage may be null if the provider
//   doesn't report it. Never includes raw message content.
//
// @typedef {object} PlannerProvider
// @property {string} name
// @property {(promptInput: {systemPrompt: string, userPrompt: string}, options: {model: string}) => Promise<PlannerRunResult>} run

/**
 * A provider that always fails fast without making any network call —
 * used as a safe default when no real provider is configured/injected,
 * and directly in tests. Callers must treat this exactly like any other
 * provider failure (deterministic fallback), never crash.
 *
 * @param {string} [reason]
 * @returns {PlannerProvider}
 */
export function createUnavailablePlannerProvider(reason = "not_configured") {
  return {
    name: "unavailable",
    async run() {
      return { ok: false, result: null, reason, usage: null };
    },
  };
}
