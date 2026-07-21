/**
 * Lightweight idea↔idea relations (no graph DB).
 * Stores id links only; never merges ideas.
 */

import { IDEA_RELATED_SIMILARITY } from "./ideaContracts.js";

/**
 * Pick related idea ids from candidate hits (semantic + lexical).
 * @param {object} input
 * @param {string} input.text
 * @param {object[]} input.candidates - existing actor ideas (may include similarity)
 * @param {number} [input.threshold]
 * @param {number} [input.limit]
 * @returns {{ relatedIdeaIds: string[], related: object[] }}
 */
export function selectRelatedIdeas(input = {}) {
  const text = String(input.text ?? "").trim().toLowerCase();
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const threshold = Number(input.threshold) || IDEA_RELATED_SIMILARITY;
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);

  if (!text || !candidates.length) {
    return { relatedIdeaIds: [], related: [] };
  }

  const tokens = tokenize(text);
  const scored = [];

  for (const idea of candidates) {
    const id = idea?.id != null ? String(idea.id) : null;
    if (!id) continue;

    const hay = `${idea.normalizedText || ""} ${idea.originalText || ""} ${(idea.tags || []).join(" ")}`.toLowerCase();
    if (!hay.trim()) continue;

    let score = Number(idea.similarity);
    if (!Number.isFinite(score)) score = 0;

    const lexical = lexicalOverlap(tokens, tokenize(hay));
    score = Math.max(score, lexical);

    // Same category is a weak boost when already somewhat related.
    if (
      idea.category &&
      input.category &&
      String(idea.category) === String(input.category) &&
      score >= threshold - 0.08
    ) {
      score = Math.min(1, score + 0.05);
    }

    if (score >= threshold) {
      scored.push({ idea, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const related = scored.slice(0, limit).map((s) => s.idea);
  return {
    relatedIdeaIds: related.map((r) => String(r.id)),
    related,
  };
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function lexicalOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hit = 0;
  for (const t of a) {
    if (setB.has(t)) hit += 1;
  }
  const ratio = hit / Math.max(a.length, 1);
  // Require at least 2 shared tokens for a strong lexical link.
  if (hit < 2) return ratio >= 0.5 ? ratio * 0.7 : 0;
  return Math.min(1, 0.55 + ratio * 0.4);
}
