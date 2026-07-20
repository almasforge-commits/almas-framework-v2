/**
 * Deterministic insight confidence scorer (0..1).
 * No LLM. Uses only supporting facts metadata already present.
 */

import { MIN_EVIDENCE_FACTS } from "./reasoningTypes.js";

/**
 * @param {object} input
 * @param {object[]} input.supportingFacts
 * @param {object[]} [input.contradictingFacts]
 * @param {number} [input.nowMs]
 * @returns {{ confidence: number, evidence: object[], breakdown: object }}
 */
export function scoreInsightConfidence(input = {}) {
  const supporting = Array.isArray(input.supportingFacts)
    ? input.supportingFacts.filter((f) => f && f.id)
    : [];
  const contradicting = Array.isArray(input.contradictingFacts)
    ? input.contradictingFacts.filter((f) => f && f.id)
    : [];
  const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();

  if (supporting.length < MIN_EVIDENCE_FACTS) {
    return {
      confidence: 0,
      evidence: [],
      breakdown: {
        supportCount: supporting.length,
        contradictionCount: contradicting.length,
        rejected: "insufficient_evidence",
      },
    };
  }

  // Base from support count (caps quickly).
  const supportScore = Math.min(1, 0.35 + supporting.length * 0.15);

  // Recency: average age decay (30 days half-ish).
  const recencyScores = supporting.map((f) => {
    const created = Number(f.createdAt) || now;
    const ageDays = Math.max(0, (now - created) / (24 * 60 * 60 * 1000));
    return Math.max(0.3, 1 - ageDays / 60);
  });
  const recencyScore =
    recencyScores.reduce((a, b) => a + b, 0) / recencyScores.length;

  // Source quality: prefer higher fact confidence / personal scope.
  const qualityScores = supporting.map((f) => {
    const c = Number(f.confidence);
    const base = Number.isFinite(c) ? c : 0.7;
    const scopeBoost = f.scope === "world" ? 0 : 0.05;
    return Math.min(1, base + scopeBoost);
  });
  const qualityScore =
    qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;

  // Consistency: shared domain overlap.
  const domains = supporting.map((f) => f.domain).filter(Boolean);
  const uniqueDomains = new Set(domains);
  const consistencyScore =
    domains.length === 0
      ? 0.5
      : Math.min(1, 0.5 + (1 - (uniqueDomains.size - 1) * 0.15));

  // Contradictions reduce confidence.
  const contradictionPenalty = Math.min(0.5, contradicting.length * 0.2);

  const raw =
    supportScore * 0.35 +
    recencyScore * 0.2 +
    qualityScore * 0.25 +
    consistencyScore * 0.2 -
    contradictionPenalty;

  const confidence = Math.min(1, Math.max(0, raw));

  const evidence = supporting.map((f, i) => ({
    factId: f.id,
    weight: Math.min(
      1,
      0.4 + (Number.isFinite(f.confidence) ? f.confidence * 0.4 : 0.3) +
        recencyScores[i] * 0.2
    ),
    reason: "supporting_fact",
  }));

  // Attach contradiction markers as zero-weight evidence notes (not support).
  for (const f of contradicting) {
    evidence.push({
      factId: f.id,
      weight: 0,
      reason: "contradicting_fact",
    });
  }

  return {
    confidence,
    evidence,
    breakdown: {
      supportCount: supporting.length,
      contradictionCount: contradicting.length,
      supportScore,
      recencyScore,
      qualityScore,
      consistencyScore,
      contradictionPenalty,
    },
  };
}
