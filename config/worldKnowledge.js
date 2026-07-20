/**
 * World Knowledge Gateway config — safe defaults.
 * May read process.env; never requires .env edits.
 */

export const WORLD_KNOWLEDGE_MODES = Object.freeze({
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active",
});

/**
 * @param {NodeJS.ProcessEnv|object} [env]
 */
export function getWorldKnowledgeConfig(env = process.env) {
  const enabledRaw = String(env?.WORLD_KNOWLEDGE_ENABLED ?? "false")
    .trim()
    .toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1";

  const modeRaw = String(env?.WORLD_KNOWLEDGE_MODE ?? "off")
    .trim()
    .toLowerCase();
  const mode = Object.values(WORLD_KNOWLEDGE_MODES).includes(modeRaw)
    ? modeRaw
    : WORLD_KNOWLEDGE_MODES.OFF;

  // Safe default-off: both enabled and non-off mode required for any wiring.
  const effectiveMode =
    enabled && mode !== WORLD_KNOWLEDGE_MODES.OFF
      ? mode
      : WORLD_KNOWLEDGE_MODES.OFF;

  const timeoutMs = parsePositiveInt(
    env?.WORLD_KNOWLEDGE_TIMEOUT_MS ?? env?.WORLD_KNOWLEDGE_PROVIDER_TIMEOUT_MS,
    3_000
  );

  return Object.freeze({
    enabled,
    mode,
    effectiveMode,
    cacheTtlMs: parsePositiveInt(env?.WORLD_KNOWLEDGE_CACHE_TTL_MS, 60_000),
    /** Alias used by gateway provider calls. */
    providerTimeoutMs: timeoutMs,
    /** Gateway-level bound (same default as provider timeout). */
    timeoutMs,
    maxResults: parsePositiveInt(env?.WORLD_KNOWLEDGE_MAX_RESULTS, 20),
    maxPerProvider: parsePositiveInt(env?.WORLD_KNOWLEDGE_MAX_PER_PROVIDER, 8),
    /** Official feed provider bounds (D-029). */
    feedTimeoutMs: parsePositiveInt(
      env?.WORLD_KNOWLEDGE_FEED_TIMEOUT_MS,
      4_000
    ),
    feedMaxBytes: parsePositiveInt(
      env?.WORLD_KNOWLEDGE_FEED_MAX_BYTES,
      512_000
    ),
    feedMaxItems: parsePositiveInt(env?.WORLD_KNOWLEDGE_FEED_MAX_ITEMS, 12),
    feedMaxAgeDays: parsePositiveInt(
      env?.WORLD_KNOWLEDGE_FEED_MAX_AGE_DAYS,
      30
    ),
  });
}

function parsePositiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
