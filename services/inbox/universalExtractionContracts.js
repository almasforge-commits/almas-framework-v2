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
 * Finite entity property set for OpenAI Structured Outputs (strict).
 * Dynamic maps are forbidden — unknown pairs go through `entityExtras`.
 */
export const EXTRACTION_ENTITY_FIELD_NAMES = Object.freeze([
  "direction",
  "amount",
  "currency",
  "description",
  "category",
  "dateText",
  "title",
  "dueDateText",
  "project",
  "priority",
  "metric",
  "value",
  "unit",
  "secondaryValue",
  "summary",
  "tags",
  "relatedProject",
  "projectName",
  "update",
  "statusHint",
  "entityExtras",
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
  const items = Array.isArray(input.items)
    ? input.items.map((item, i) =>
        createExtractedItem({ ...item, index: item?.index ?? i })
      )
    : [];

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

const nullableString = Object.freeze({ type: ["string", "null"] });
const nullableNumber = Object.freeze({ type: ["number", "null"] });

/** Strict key/value row for residual entity fields (no free-form maps). */
const ENTITY_EXTRA_ROW_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    value: { type: ["string", "number", "boolean", "null"] },
  },
  required: ["key", "value"],
});

const EXTRACTION_ENTITIES_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    direction: nullableString,
    amount: nullableNumber,
    currency: nullableString,
    description: nullableString,
    category: nullableString,
    dateText: nullableString,
    title: nullableString,
    dueDateText: nullableString,
    project: nullableString,
    priority: nullableString,
    metric: nullableString,
    value: nullableNumber,
    unit: nullableString,
    secondaryValue: nullableNumber,
    summary: nullableString,
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
    },
    relatedProject: nullableString,
    projectName: nullableString,
    update: nullableString,
    statusHint: nullableString,
    entityExtras: {
      type: "array",
      maxItems: 40,
      items: ENTITY_EXTRA_ROW_SCHEMA,
    },
  },
  required: [...EXTRACTION_ENTITY_FIELD_NAMES],
});

/** OpenAI json_schema for extraction provider responses. */
export const UNIVERSAL_EXTRACTION_JSON_SCHEMA = Object.freeze({
  name: "almas_universal_extraction",
  strict: true,
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
            entities: EXTRACTION_ENTITIES_SCHEMA,
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

/**
 * Convert OpenAI transport entities (strict object + entityExtras) → internal bag.
 * Drops nulls. Merges entityExtras key/value rows. Accepts legacy plain objects.
 *
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeTransportEntities(raw) {
  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw.slice(0, 40)) {
      if (!row || typeof row !== "object") continue;
      const key = typeof row.key === "string" ? row.key.trim() : "";
      if (!key) continue;
      if (row.value === null || row.value === undefined) continue;
      out[key] = row.value;
    }
    return out;
  }

  if (!raw || typeof raw !== "object") return {};

  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "entityExtras") continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }

  if (Array.isArray(raw.entityExtras)) {
    for (const row of raw.entityExtras.slice(0, 40)) {
      if (!row || typeof row !== "object") continue;
      const key = typeof row.key === "string" ? row.key.trim() : "";
      if (!key || key === "entityExtras") continue;
      if (row.value === null || row.value === undefined) continue;
      if (out[key] === undefined) out[key] = row.value;
    }
  }

  return out;
}

/**
 * Recursively assert every object node has additionalProperties:false.
 * @param {object} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function findObjectsMissingAdditionalPropertiesFalse(schema, path = "") {
  const failures = [];
  walkSchema(schema, path, failures);
  return failures;
}

function walkSchema(node, path, failures) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((child, i) => walkSchema(child, `${path}/${i}`, failures));
    return;
  }

  if (
    node.type === "object" ||
    (Array.isArray(node.type) && node.type.includes("object"))
  ) {
    if (node.additionalProperties !== false) {
      failures.push(path || "/");
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [key, child] of Object.entries(node.properties)) {
      walkSchema(child, `${path}/properties/${key}`, failures);
    }
  }

  if (node.items) {
    walkSchema(node.items, `${path}/items`, failures);
  }

  for (const combiner of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[combiner])) {
      node[combiner].forEach((child, i) =>
        walkSchema(child, `${path}/${combiner}/${i}`, failures)
      );
    }
  }

  if (node.$defs && typeof node.$defs === "object") {
    for (const [key, child] of Object.entries(node.$defs)) {
      walkSchema(child, `${path}/$defs/${key}`, failures);
    }
  }

  if (node.definitions && typeof node.definitions === "object") {
    for (const [key, child] of Object.entries(node.definitions)) {
      walkSchema(child, `${path}/definitions/${key}`, failures);
    }
  }
}

/**
 * @param {object} [schemaRoot]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function assertUniversalExtractionSchemaStrict(
  schemaRoot = UNIVERSAL_EXTRACTION_JSON_SCHEMA.schema
) {
  const failures = findObjectsMissingAdditionalPropertiesFalse(schemaRoot);
  return { ok: failures.length === 0, failures };
}
