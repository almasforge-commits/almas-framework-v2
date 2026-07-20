import { sanitizeInboxMetadata } from "./inboxSanitizer.js";
import { createExtractionResult } from "./universalExtractionContracts.js";

// Sanitizes universal extraction payloads for Inbox persistence.
// Never stores prompts, embeddings, vectors, raw provider blobs, or CoT.

const DEFAULT_MAX_ITEMS = 5;
const DEFAULT_MAX_CONTENT = 500;

/**
 * @param {object|null|undefined} extraction
 * @param {object} [options]
 * @returns {object|null}
 */
export function sanitizeUniversalExtraction(extraction, options = {}) {
  if (!extraction || typeof extraction !== "object") return null;

  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxContent = options.maxStringLength ?? DEFAULT_MAX_CONTENT;

  const rawItems = Array.isArray(extraction.items) ? extraction.items : [];
  const items = rawItems.slice(0, maxItems).map((item, index) => {
    const entities = sanitizeInboxMetadata(item?.entities ?? {}, {
      maxStringLength: maxContent,
      maxArrayLength: 20,
      maxDepth: 3,
      maxKeys: 40,
    });

    return sanitizeInboxMetadata(
      {
        index: Number.isInteger(item?.index) ? item.index : index,
        kind: typeof item?.kind === "string" ? item.kind : "unknown",
        content:
          typeof item?.content === "string"
            ? item.content.length > maxContent
              ? `${item.content.slice(0, maxContent)}…`
              : item.content
            : "",
        confidence:
          typeof item?.confidence === "number" && Number.isFinite(item.confidence)
            ? item.confidence
            : 0,
        entities: entities && typeof entities === "object" ? entities : {},
        temporal: {
          raw:
            typeof item?.temporal?.raw === "string"
              ? item.temporal.raw.slice(0, 80)
              : null,
          resolvedDate:
            typeof item?.temporal?.resolvedDate === "string"
              ? item.temporal.resolvedDate.slice(0, 40)
              : null,
          timezone:
            typeof item?.temporal?.timezone === "string"
              ? item.temporal.timezone.slice(0, 40)
              : null,
        },
        requiresClarification: Boolean(item?.requiresClarification),
        clarificationReason:
          typeof item?.clarificationReason === "string"
            ? item.clarificationReason.slice(0, 80)
            : null,
        relationships: Array.isArray(item?.relationships)
          ? item.relationships.slice(0, 20).map((rel) =>
              sanitizeInboxMetadata(
                {
                  type: rel?.type ?? null,
                  sourceKind: rel?.sourceKind ?? null,
                  targetKind: rel?.targetKind ?? null,
                  confidence:
                    typeof rel?.confidence === "number" ? rel.confidence : 0,
                  metadata:
                    rel?.metadata && typeof rel.metadata === "object"
                      ? rel.metadata
                      : {},
                },
                {
                  maxStringLength: maxContent,
                  maxArrayLength: 10,
                  maxDepth: 3,
                  maxKeys: 12,
                }
              )
            )
          : [],
      },
      {
        maxStringLength: maxContent,
        maxArrayLength: 20,
        maxDepth: 4,
        maxKeys: 24,
      }
    );
  });

  const result = createExtractionResult({
    items,
    tier: extraction.tier,
    reasonCode: extraction.reasonCode,
    language: extraction.language,
    needsClarification: extraction.needsClarification,
    truncated: extraction.truncated || rawItems.length > maxItems,
  });

  // Drop any accidental sensitive keys from a shallow wrap.
  return sanitizeInboxMetadata(
    {
      tier: result.tier,
      reasonCode: result.reasonCode,
      language: result.language,
      needsClarification: result.needsClarification,
      truncated: result.truncated,
      itemCount: result.itemCount,
      items: result.items,
    },
    {
      maxStringLength: maxContent,
      maxArrayLength: maxItems + 1,
      maxDepth: 5,
      maxKeys: 30,
    }
  );
}
