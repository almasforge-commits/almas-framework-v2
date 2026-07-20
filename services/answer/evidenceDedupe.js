/**
 * Deduplicate answer evidence before composition.
 * Same id / same normalized fact → keep highest-confidence item.
 * Provenance of dropped duplicates is retained on the winner.
 */

import { normalizeAnswerText } from "./answerContracts.js";
import { normalizeMemoryFactContent } from "../storage/memoryFilter.js";

/**
 * @param {object[]} evidence
 * @returns {object[]}
 */
export function dedupeEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return [];

  /** @type {Map<string, object>} */
  const winners = new Map();
  /** @type {string[]} */
  const order = [];

  for (const item of evidence) {
    if (!item || typeof item !== "object") continue;
    const key = evidenceDedupeKey(item);
    if (!key) continue;

    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, cloneWithNormalizedContent(item));
      order.push(key);
      continue;
    }

    const nextConf = Number(item.confidence) || 0;
    const prevConf = Number(existing.confidence) || 0;
    if (nextConf > prevConf) {
      const merged = cloneWithNormalizedContent(item);
      merged.provenance = mergeProvenance(item.provenance, existing);
      winners.set(key, merged);
    } else {
      existing.provenance = mergeProvenance(existing.provenance, item);
    }
  }

  return order.map((k) => winners.get(k)).filter(Boolean);
}

/**
 * @param {object} item
 * @returns {string}
 */
export function evidenceDedupeKey(item) {
  const norm = normalizeEvidenceText(item.content || item.summary);
  if (norm) return `text:${norm}`;
  if (item.factId != null && String(item.factId).trim()) {
    return `id:${String(item.factId).trim()}`;
  }
  if (item.id != null && String(item.id).trim()) {
    const id = String(item.id).trim().replace(/^memory:/i, "");
    return `id:${id}`;
  }
  return "";
}

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeEvidenceText(text) {
  const stripped = normalizeMemoryFactContent(text);
  return normalizeAnswerText(stripped);
}

function cloneWithNormalizedContent(item) {
  const content = normalizeMemoryFactContent(item.content || item.summary || "");
  const summary = content
    ? content.slice(0, 280)
    : String(item.summary || item.content || "").slice(0, 280);
  return {
    ...item,
    content: content || item.content,
    summary: summary || item.summary,
  };
}

function mergeProvenance(primary, duplicate) {
  const base =
    primary && typeof primary === "object"
      ? { ...primary }
      : {
          sourceType: null,
          provider: null,
          retrievedAt: null,
        };

  const prev = Array.isArray(base.duplicates) ? base.duplicates.slice() : [];
  prev.push({
    id: duplicate?.id ?? null,
    factId: duplicate?.factId ?? null,
    confidence: duplicate?.confidence ?? null,
    source: duplicate?.source ?? null,
  });
  base.duplicates = prev.slice(0, 20);
  return base;
}
