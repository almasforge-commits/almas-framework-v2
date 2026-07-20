/**
 * Reasoning contracts — insights and recommendations.
 * Never invents facts; only structures derived conclusions.
 */

import {
  INSIGHT_STATUSES,
  RECOMMENDATION_STATUSES,
  isInsightType,
} from "./reasoningTypes.js";

/**
 * @param {string} text
 */
export function normalizeInsightText(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…,;:]+$/u, "");
}

/**
 * Stable non-crypto hash for idempotency.
 * @param {string} input
 */
export function stableInsightHash(input) {
  const s = String(input ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `rih_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * @param {string} actorKey
 * @param {string} type
 * @param {string} normalizedTitle
 * @param {string|null} [requestKey]
 */
export function buildInsightIdempotencyKey(
  actorKey,
  type,
  normalizedTitle,
  requestKey = null
) {
  if (typeof requestKey === "string" && requestKey.trim()) {
    return `req:${requestKey.trim()}`;
  }
  return `hash:${stableInsightHash(`${actorKey}|${type}|${normalizedTitle}`)}`;
}

/**
 * @param {object} input
 */
export function createEvidence(input = {}) {
  const factId = String(input.factId ?? "").trim();
  if (!factId) return null;
  const weight = Number(input.weight);
  return {
    factId,
    weight: Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0.5,
    reason:
      typeof input.reason === "string" ? input.reason.slice(0, 200) : "support",
  };
}

/**
 * @param {object} input
 */
export function createInsight(input = {}) {
  const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const title = String(input.title ?? "").trim();
  const normalizedTitle =
    typeof input.normalizedTitle === "string" && input.normalizedTitle
      ? input.normalizedTitle
      : normalizeInsightText(title);
  const actorKey = String(input.actorKey || "");
  const type = isInsightType(input.type) ? input.type : null;
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.map(createEvidence).filter(Boolean)
    : [];

  const idempotencyKey = buildInsightIdempotencyKey(
    actorKey,
    type || "unknown",
    normalizedTitle,
    input.requestKey ?? null
  );

  return {
    id:
      input.id ??
      `ins_${idempotencyKey.replace(/[^a-z0-9_]/gi, "_").slice(0, 48)}`,
    actorKey,
    type,
    title,
    description: String(input.description ?? "").trim(),
    confidence: clamp01(input.confidence),
    evidence,
    relatedFacts: Array.isArray(input.relatedFacts)
      ? [...new Set(input.relatedFacts.map(String))]
      : evidence.map((e) => e.factId),
    relatedEntities: Array.isArray(input.relatedEntities)
      ? input.relatedEntities.map(String).filter(Boolean).slice(0, 32)
      : [],
    relatedDomains: Array.isArray(input.relatedDomains)
      ? [...new Set(input.relatedDomains.map(String).filter(Boolean))]
      : [],
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
    status: INSIGHT_STATUSES.includes(input.status) ? input.status : "active",
    requestKey:
      typeof input.requestKey === "string" && input.requestKey.trim()
        ? input.requestKey.trim()
        : null,
    idempotencyKey,
  };
}

/**
 * @param {object} input
 */
export function createRecommendation(input = {}) {
  const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const title = String(input.title ?? "").trim();
  const actorKey = String(input.actorKey || "");
  const insightIds = Array.isArray(input.insightIds)
    ? [...new Set(input.insightIds.map(String).filter(Boolean))]
    : [];
  const normalizedTitle = normalizeInsightText(title);
  const idempotencyKey = buildInsightIdempotencyKey(
    actorKey,
    `rec:${input.insightIds?.[0] || "none"}`,
    normalizedTitle,
    input.requestKey ?? null
  );

  return {
    id:
      input.id ??
      `rec_${idempotencyKey.replace(/[^a-z0-9_]/gi, "_").slice(0, 48)}`,
    actorKey,
    title,
    description: String(input.description ?? "").trim(),
    insightIds,
    confidence: clamp01(input.confidence),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
    status: RECOMMENDATION_STATUSES.includes(input.status)
      ? input.status
      : "active",
    requestKey:
      typeof input.requestKey === "string" && input.requestKey.trim()
        ? input.requestKey.trim()
        : null,
    idempotencyKey,
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
