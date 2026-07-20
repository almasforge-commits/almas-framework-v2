/**
 * Deterministic provider result scoring.
 */

import { PROVIDER_TRUST } from "./providerContracts.js";

const MS_DAY = 86_400_000;

/**
 * @param {object} result — normalized provider result
 * @param {object} [opts]
 * @param {number} [opts.nowMs]
 * @param {string} [opts.query]
 */
export function scoreProviderResult(result, opts = {}) {
  const now = opts.nowMs ?? Date.now();
  const trust =
    PROVIDER_TRUST[result.provider] ?? PROVIDER_TRUST.default ?? 0.4;
  const confidence = Number(result.confidence) || 0;

  let recency = 0.5;
  if (result.publishedAt) {
    const age = Math.max(0, now - result.publishedAt);
    recency = Math.max(0, 1 - age / (365 * MS_DAY));
  }

  const languageBoost =
    result.language === "en" || result.language === "ru" ? 0.05 : 0;

  const meta = result.metadata && typeof result.metadata === "object"
    ? result.metadata
    : {};
  const metaQuality =
    (result.url ? 0.05 : 0) +
    (result.author ? 0.03 : 0) +
    (meta.quality ? Math.min(0.1, Number(meta.quality) || 0) : 0);

  const q = String(opts.query || "")
    .trim()
    .toLowerCase();
  let relevance = 0;
  if (q) {
    const hay = `${result.title} ${result.summary}`.toLowerCase();
    if (hay.includes(q)) relevance = 0.15;
    else {
      const tokens = q.split(/\s+/).filter((t) => t.length > 2);
      let hits = 0;
      for (const t of tokens) if (hay.includes(t)) hits += 1;
      if (tokens.length) relevance = 0.12 * (hits / tokens.length);
    }
  }

  const score =
    Math.round(
      (0.35 * trust +
        0.3 * confidence +
        0.15 * recency +
        languageBoost +
        metaQuality +
        relevance) *
        1000
    ) / 1000;

  return Math.max(0, Math.min(1, score));
}
