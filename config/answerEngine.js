/**
 * Answer Engine config — safe defaults.
 * May read process.env if present; never requires .env changes.
 */

export function getAnswerEngineConfig(env = process.env) {
  const enabledRaw = String(env?.ANSWER_ENGINE_ENABLED ?? "false")
    .trim()
    .toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1";

  return Object.freeze({
    enabled,
    minAnswerConfidence: parseUnit(env?.ANSWER_ENGINE_MIN_CONFIDENCE, 0.55),
    maxEvidence: parsePositiveInt(env?.ANSWER_ENGINE_MAX_EVIDENCE, 40),
    maxSources: parsePositiveInt(env?.ANSWER_ENGINE_MAX_SOURCES, 12),
    maxWorldHits: parsePositiveInt(env?.ANSWER_ENGINE_MAX_WORLD, 8),
    maxPersonalHits: parsePositiveInt(env?.ANSWER_ENGINE_MAX_PERSONAL, 20),
    maxReasoningHits: parsePositiveInt(env?.ANSWER_ENGINE_MAX_REASONING, 12),
    maxDomainHits: parsePositiveInt(env?.ANSWER_ENGINE_MAX_DOMAIN, 12),
    /** Architecture milestone: never execute. */
    allowExecution: false,
  });
}

function parsePositiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function parseUnit(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}
