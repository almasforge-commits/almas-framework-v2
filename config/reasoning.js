/**
 * Reasoning shadow observation config — safe defaults.
 * May read process.env if present; never requires .env changes.
 */

export function getReasoningConfig(env = process.env) {
  const enabledRaw = String(env?.REASONING_ENABLED ?? "false")
    .trim()
    .toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1";

  const modeRaw = String(env?.REASONING_MODE ?? (enabled ? "shadow" : "off"))
    .trim()
    .toLowerCase();
  const mode = ["off", "shadow"].includes(modeRaw) ? modeRaw : "off";

  const maxFacts = parsePositiveInt(env?.REASONING_MAX_FACTS, 100);
  const maxInsights = parsePositiveInt(env?.REASONING_MAX_INSIGHTS, 50);
  const maxRecommendations = parsePositiveInt(
    env?.REASONING_MAX_RECOMMENDATIONS,
    50
  );

  return Object.freeze({
    enabled: enabled && mode === "shadow",
    mode: enabled ? mode : "off",
    maxFacts,
    maxInsights,
    maxRecommendations,
    shadow: true,
  });
}

function parsePositiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
