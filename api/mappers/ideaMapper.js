/**
 * Map Ideas table rows / service objects to Mini App DTOs.
 */

import { deriveIdeaTitle } from "../../services/ideas/ideaContracts.js";

/**
 * @param {object} row
 * @returns {object|null}
 */
export function mapIdea(row) {
  if (!row || typeof row !== "object") return null;

  const text = String(
    row.text ??
      row.normalizedText ??
      row.normalized_text ??
      row.originalText ??
      row.original_text ??
      ""
  ).trim();

  const relatedIdeas = normalizeRelated(
    row.relatedIdeas ??
      row.relatedIdeaIds ??
      row.metadata?.relatedIdeaIds ??
      row.metadata?.related_idea_ids
  );

  return {
    id: row.id ?? null,
    title:
      row.title ||
      deriveIdeaTitle(text) ||
      String(row.normalizedText ?? row.normalized_text ?? "").slice(0, 120) ||
      null,
    text,
    content: text,
    originalText: row.originalText ?? row.original_text ?? null,
    category: row.category ?? "other",
    confidence: row.confidence ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    language: row.language ?? null,
    source: row.source ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    relatedIdeas,
    archived: Boolean(row.archived),
  };
}

function normalizeRelated(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item == null) return null;
      if (typeof item === "string" || typeof item === "number") {
        return { id: String(item) };
      }
      if (typeof item === "object" && item.id != null) {
        return {
          id: String(item.id),
          title: item.title ?? null,
          category: item.category ?? null,
          listIndex: item.listIndex ?? null,
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 20);
}
