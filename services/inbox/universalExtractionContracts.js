import {
  listDomainIds,
  listExtractableDomainIds,
  isKnownDomain,
} from "../../config/domainRegistry.js";

// Canonical contracts for Universal Information Extraction (shadow-only).
// Domain kinds come from config/domainRegistry.js (single source of truth).
// Pure helpers — no Telegram / OpenAI / Supabase / domain-service imports.

export const EXTRACTION_KINDS = Object.freeze(listExtractableDomainIds());

export const FINANCE_DIRECTIONS = Object.freeze(["expense", "income"]);

export const HEALTH_METRICS = Object.freeze([
  "weight",
  "blood_pressure",
  "pulse",
  "steps",
  "sleep",
  "workout",
]);

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function validateExtractionKind(value) {
  return isKnownDomain(value) && EXTRACTION_KINDS.includes(value) ? value : null;
}

// Re-export for callers that need the full domain id list.
export { listDomainIds, isKnownDomain };

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createEmptyTemporal(input = {}) {
  return {
    raw: input.raw ?? null,
    resolvedDate: input.resolvedDate ?? null,
    timezone: input.timezone ?? null,
  };
}

/**
 * Builds one canonical extracted item. Does not mutate caller input.
 *
 * @param {object} [input]
 * @returns {object}
 */
export function createExtractedItem(input = {}) {
  const kind = validateExtractionKind(input.kind) ?? "unknown";
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : 0;

  const content =
    typeof input.content === "string"
      ? input.content
      : input.content == null
        ? ""
        : String(input.content);

  const entities =
    input.entities && typeof input.entities === "object" && !Array.isArray(input.entities)
      ? { ...input.entities }
      : {};

  const temporal =
    input.temporal && typeof input.temporal === "object"
      ? createEmptyTemporal(input.temporal)
      : createEmptyTemporal();

  return {
    index: Number.isInteger(input.index) ? input.index : 0,
    kind,
    content,
    confidence,
    entities,
    temporal,
    relationships: Array.isArray(input.relationships) ? input.relationships.slice() : [],
    requiresClarification: Boolean(input.requiresClarification),
    clarificationReason:
      typeof input.clarificationReason === "string" ? input.clarificationReason : null,
  };
}

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createExtractionResult(input = {}) {
  const items = Array.isArray(input.items) ? input.items.map((item, i) =>
    createExtractedItem({ ...item, index: item?.index ?? i })
  ) : [];

  return {
    items,
    tier: typeof input.tier === "string" ? input.tier : "deterministic",
    reasonCode: typeof input.reasonCode === "string" ? input.reasonCode : "ok",
    language: typeof input.language === "string" ? input.language : "unknown",
    needsClarification: Boolean(input.needsClarification),
    truncated: Boolean(input.truncated),
    itemCount: items.length,
  };
}

/** OpenAI json_schema for extraction provider responses. */
export const UNIVERSAL_EXTRACTION_JSON_SCHEMA = Object.freeze({
  name: "almas_universal_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      language: { type: "string" },
      reasonCode: { type: "string" },
      needsClarification: { type: "boolean" },
      items: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: [...EXTRACTION_KINDS] },
            content: { type: "string" },
            confidence: { type: "number" },
            entities: { type: "object", additionalProperties: true },
            temporalRaw: { type: ["string", "null"] },
            requiresClarification: { type: "boolean" },
            clarificationReason: { type: ["string", "null"] },
          },
          required: [
            "kind",
            "content",
            "confidence",
            "entities",
            "temporalRaw",
            "requiresClarification",
            "clarificationReason",
          ],
        },
      },
    },
    required: ["language", "reasonCode", "needsClarification", "items"],
  },
});
