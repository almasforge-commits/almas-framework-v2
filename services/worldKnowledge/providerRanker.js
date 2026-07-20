/**
 * Rank + dedupe world knowledge results — stable deterministic order.
 */

import { scoreProviderResult } from "./providerScorer.js";
import { createWorldEvidence } from "./providerContracts.js";

/**
 * @param {object[]} results — normalized provider results
 * @param {object} [opts]
 */
export function rankWorldResults(results, opts = {}) {
  if (!Array.isArray(results) || results.length === 0) return [];

  const nowMs = opts.nowMs ?? Date.now();
  const maxResults = opts.maxResults ?? 20;
  const query = opts.query || "";

  const deduped = dedupeResults(results);
  const scored = deduped.map((r) => {
    const score = scoreProviderResult(r, { nowMs, query });
    return createWorldEvidence(r, {
      retrievedAt: opts.retrievedAt ?? nowMs,
      score,
    });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.confidence || 0) !== (a.confidence || 0)) {
      return (b.confidence || 0) - (a.confidence || 0);
    }
    const pa = a.publishedAt || 0;
    const pb = b.publishedAt || 0;
    if (pb !== pa) return pb - pa;
    return String(a.url || a.title).localeCompare(String(b.url || b.title));
  });

  return scored.slice(0, maxResults);
}

/**
 * Remove near-duplicates by URL then normalized title+summary prefix.
 * @param {object[]} results
 */
export function dedupeResults(results) {
  const seenUrl = new Set();
  const seenContent = new Set();
  const out = [];

  for (const r of results) {
    if (!r) continue;
    const urlKey = r.url ? String(r.url).trim().toLowerCase() : null;
    if (urlKey) {
      if (seenUrl.has(urlKey)) continue;
      seenUrl.add(urlKey);
    }
    const contentKey = `${String(r.title || "")
      .trim()
      .toLowerCase()}|${String(r.summary || "")
      .trim()
      .toLowerCase()
      .slice(0, 120)}`;
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);
    out.push(r);
  }
  return out;
}
