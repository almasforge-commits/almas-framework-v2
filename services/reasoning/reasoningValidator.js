/**
 * Reasoning validator — reject unsafe / unsupported insight drafts.
 */

import {
  DEFAULT_INSIGHT_CONFIDENCE_THRESHOLD,
  MIN_EVIDENCE_FACTS,
  isInsightType,
} from "./reasoningTypes.js";

export const REASONING_REJECT = Object.freeze({
  MISSING_ACTOR: "missing_actor_key",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  CONTRADICTING_EVIDENCE: "contradicting_evidence",
  LOW_CONFIDENCE: "low_confidence",
  DUPLICATE: "duplicate_insight",
  UNSUPPORTED_TYPE: "unsupported_type",
  WORLD_KNOWLEDGE: "world_knowledge",
  TIMELINE_FACTS: "timeline_facts",
  TEMPORARY_CONTEXT: "temporary_conversation_context",
  MISSING_INSIGHTS: "missing_insights",
  EMPTY_TITLE: "empty_title",
});

/**
 * @param {object} input
 * @param {object} [options]
 */
export function validateInsightCandidate(input = {}, options = {}) {
  const threshold = Number.isFinite(options.confidenceThreshold)
    ? options.confidenceThreshold
    : DEFAULT_INSIGHT_CONFIDENCE_THRESHOLD;

  const actorKey = String(input.actorKey ?? "").trim();
  if (!actorKey) {
    return { ok: false, reason: REASONING_REJECT.MISSING_ACTOR };
  }

  if (!isInsightType(input.type)) {
    return { ok: false, reason: REASONING_REJECT.UNSUPPORTED_TYPE };
  }

  const title = String(input.title ?? "").trim();
  if (!title) {
    return { ok: false, reason: REASONING_REJECT.EMPTY_TITLE };
  }

  const supporting = Array.isArray(input.supportingFacts)
    ? input.supportingFacts
    : [];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];

  const supportIds = new Set(
    [
      ...supporting.map((f) => f?.id),
      ...evidence
        .filter((e) => e && e.reason !== "contradicting_fact")
        .map((e) => e.factId),
    ].filter(Boolean)
  );

  if (supportIds.size < MIN_EVIDENCE_FACTS) {
    return { ok: false, reason: REASONING_REJECT.INSUFFICIENT_EVIDENCE };
  }

  // World knowledge never used as evidence.
  if (supporting.some((f) => f?.scope === "world")) {
    return { ok: false, reason: REASONING_REJECT.WORLD_KNOWLEDGE };
  }

  if (supporting.some((f) => f?.domain === "Timeline")) {
    return { ok: false, reason: REASONING_REJECT.TIMELINE_FACTS };
  }

  if (supporting.some((f) => f?.temporary === true || f?.sourceType === "clarification_pending")) {
    return { ok: false, reason: REASONING_REJECT.TEMPORARY_CONTEXT };
  }

  const contradicting = Array.isArray(input.contradictingFacts)
    ? input.contradictingFacts
    : [];
  // Hard reject only when contradictions dominate support.
  if (contradicting.length >= supportIds.size) {
    return { ok: false, reason: REASONING_REJECT.CONTRADICTING_EVIDENCE };
  }

  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < threshold) {
    return { ok: false, reason: REASONING_REJECT.LOW_CONFIDENCE };
  }

  return { ok: true };
}

/**
 * Recommendations must reference at least one accepted insight.
 * @param {object} input
 */
export function validateRecommendationCandidate(input = {}) {
  const actorKey = String(input.actorKey ?? "").trim();
  if (!actorKey) {
    return { ok: false, reason: REASONING_REJECT.MISSING_ACTOR };
  }
  const title = String(input.title ?? "").trim();
  if (!title) {
    return { ok: false, reason: REASONING_REJECT.EMPTY_TITLE };
  }
  const insightIds = Array.isArray(input.insightIds)
    ? input.insightIds.filter(Boolean)
    : [];
  if (insightIds.length === 0) {
    return { ok: false, reason: REASONING_REJECT.MISSING_INSIGHTS };
  }
  return { ok: true };
}
