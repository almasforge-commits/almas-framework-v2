/**
 * Deterministic evidence ranking.
 * Inputs: confidence, recency, source quality, consistency, reasoning support, contradictions.
 */

import { SOURCE_TRUST, SCOPE_PRIORITY } from "./answerContracts.js";

const MS_DAY = 86_400_000;

/**
 * @param {object[]} evidence
 * @param {object} [opts]
 * @returns {object[]} ordered evidence with score set
 */
export function rankEvidence(evidence, opts = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0) return [];

  const now = opts.nowMs ?? Date.now();
  const max = opts.maxEvidence ?? 40;

  // Consistency: boost items whose normalized content appears more than once
  // across stronger scopes (personal/domain).
  const contentCounts = new Map();
  for (const e of evidence) {
    const key = normalizeKey(e.content || e.summary);
    if (!key) continue;
    contentCounts.set(key, (contentCounts.get(key) || 0) + 1);
  }

  const hasReasoning = evidence.some((e) => e.scope === "reasoning");
  const conflictGroups = new Set(
    evidence.filter((e) => e.conflict).map((e) => e.conflictGroup).filter(Boolean)
  );

  const scored = evidence.map((e) => {
    const trust = SOURCE_TRUST[e.source] ?? 0.5;
    const confidence = Number(e.confidence) || 0;
    const ageMs = Math.max(0, now - (Number(e.timestamp) || now));
    const recency = Math.max(0, 1 - ageMs / (30 * MS_DAY)); // decay over ~30d
    const key = normalizeKey(e.content || e.summary);
    const consistency = key && (contentCounts.get(key) || 0) > 1 ? 0.15 : 0;
    const reasoningSupport =
      e.scope === "reasoning"
        ? 0.1
        : hasReasoning && e.scope === "personal"
          ? 0.05
          : 0;
    const contradictionPenalty =
      e.conflict || (e.conflictGroup && conflictGroups.has(e.conflictGroup))
        ? 0.2
        : 0;

    const priorityBoost =
      0.05 * (4 - (SCOPE_PRIORITY[e.scope] ?? 4));

    const score =
      Math.round(
        (0.4 * confidence +
          0.2 * trust +
          0.15 * recency +
          consistency +
          reasoningSupport +
          priorityBoost -
          contradictionPenalty) *
          1000
      ) / 1000;

    return { ...e, score: Math.max(0, Math.min(1, score)) };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: stronger scope, then newer, then id
    const pa = SCOPE_PRIORITY[a.scope] ?? 9;
    const pb = SCOPE_PRIORITY[b.scope] ?? 9;
    if (pa !== pb) return pa - pb;
    if (b.timestamp !== a.timestamp) return (b.timestamp || 0) - (a.timestamp || 0);
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  return scored.slice(0, max);
}

function normalizeKey(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 200);
}
