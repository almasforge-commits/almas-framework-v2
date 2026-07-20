// Universal relationship contracts. Pure — no I/O / Telegram / domain services.
// Relationships only connect entities/items that already exist.

export const RELATIONSHIP_TYPES = Object.freeze([
  "belongs_to",
  "related_to",
  "created_from",
  "inspired_by",
  "assigned_to",
  "participant",
  "paid_to",
  "about",
  "depends_on",
  "references",
  "mentions",
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isKnownRelationshipType(value) {
  return typeof value === "string" && RELATIONSHIP_TYPES.includes(value);
}

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createRelationship(input = {}) {
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : 0;

  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {};

  return {
    type: isKnownRelationshipType(input.type) ? input.type : null,
    sourceKind: typeof input.sourceKind === "string" ? input.sourceKind : null,
    targetKind: typeof input.targetKind === "string" ? input.targetKind : null,
    confidence,
    metadata,
  };
}
