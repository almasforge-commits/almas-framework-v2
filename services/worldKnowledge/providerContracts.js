/**
 * World Knowledge provider contracts — closed vocabulary + result shape.
 */

export const WORLD_SOURCE_TYPES = Object.freeze([
  "news",
  "documentation",
  "research",
  "web",
  "community",
  "official",
  "blog",
  "video",
  "future",
]);

export const PROVIDER_TRUST = Object.freeze({
  static: 0.5,
  mock_news: 0.55,
  mock_research: 0.7,
  mock_documentation: 0.75,
  default: 0.4,
});

/**
 * @param {object} input
 */
export function createProviderResult(input = {}) {
  const sourceType = WORLD_SOURCE_TYPES.includes(input.sourceType)
    ? input.sourceType
    : "web";

  return {
    provider: String(input.provider ?? "unknown").slice(0, 64),
    title: String(input.title ?? "").slice(0, 500),
    summary: String(input.summary ?? input.content ?? "").slice(0, 2000),
    url: input.url == null ? null : String(input.url).slice(0, 2000),
    publishedAt: normalizeTime(input.publishedAt),
    language: String(input.language ?? "unknown").slice(0, 16),
    author: input.author == null ? null : String(input.author).slice(0, 300),
    confidence: clamp01(input.confidence),
    sourceType,
    metadata:
      input.metadata && typeof input.metadata === "object"
        ? { ...input.metadata }
        : {},
  };
}

/**
 * Gateway evidence item with full provenance.
 * @param {object} result — provider result
 * @param {object} [extra]
 */
export function createWorldEvidence(result, extra = {}) {
  const base = createProviderResult(result);
  return {
    ...base,
    scope: "world",
    retrievedAt: normalizeTime(extra.retrievedAt) ?? Date.now(),
    score: typeof extra.score === "number" ? clamp01(extra.score) : null,
    provenance: {
      provider: base.provider,
      retrievedAt: normalizeTime(extra.retrievedAt) ?? Date.now(),
      sourceType: base.sourceType,
      confidence: base.confidence,
      url: base.url,
      language: base.language,
      publishedAt: base.publishedAt,
    },
  };
}

/**
 * Minimal provider interface check.
 * @param {object} provider
 */
export function isWorldProvider(provider) {
  if (!provider || typeof provider !== "object") return false;
  return (
    typeof provider.id === "string" &&
    provider.id.trim() &&
    typeof provider.search === "function" &&
    typeof provider.initialize === "function" &&
    typeof provider.health === "function" &&
    typeof provider.shutdown === "function"
  );
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return Math.round(x * 1000) / 1000;
}

function normalizeTime(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}
