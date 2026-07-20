/**
 * Maps domain Inbox rows to Mini App InboxItem DTOs.
 */

const ALLOWED_SOURCES = new Set([
  "telegram_text",
  "telegram_voice",
  "youtube",
  "note",
]);

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function extractFromUniversal(metadata = {}) {
  const ue = metadata.universalExtraction;
  const items = Array.isArray(ue?.items) ? ue.items : [];
  const extractedItems = items.map((item) => ({
    kind: String(item.kind ?? item.informationKind ?? "unknown"),
    content: String(item.content ?? item.text ?? item.summary ?? ""),
  }));

  const entities = {};
  const relationships = [];

  for (const item of items) {
    if (item.entities && typeof item.entities === "object") {
      for (const [key, value] of Object.entries(item.entities)) {
        if (!Array.isArray(value)) continue;
        if (!entities[key]) entities[key] = [];
        for (const entry of value) {
          const asString = typeof entry === "string" ? entry : String(entry?.value ?? entry);
          if (asString && !entities[key].includes(asString)) {
            entities[key].push(asString);
          }
        }
      }
    }
    if (Array.isArray(item.relationships)) {
      for (const rel of item.relationships) {
        relationships.push({
          type: String(rel.type ?? "related_to"),
          sourceKind: String(rel.sourceKind ?? rel.source ?? ""),
          targetKind: String(rel.targetKind ?? rel.target ?? ""),
        });
      }
    }
  }

  if (Array.isArray(ue?.relationships)) {
    for (const rel of ue.relationships) {
      relationships.push({
        type: String(rel.type ?? "related_to"),
        sourceKind: String(rel.sourceKind ?? rel.source ?? ""),
        targetKind: String(rel.targetKind ?? rel.target ?? ""),
      });
    }
  }

  return { extractedItems, entities, relationships };
}

function executionSummaryText(executionSummary) {
  if (!executionSummary) return "";
  if (typeof executionSummary === "string") return executionSummary;
  if (typeof executionSummary === "object") {
    return (
      executionSummary.summary ||
      executionSummary.message ||
      JSON.stringify(executionSummary)
    );
  }
  return String(executionSummary);
}

export function mapInboxItem(row) {
  const sourceType = ALLOWED_SOURCES.has(row.sourceType)
    ? row.sourceType
    : "telegram_text";

  const { extractedItems, entities, relationships } = extractFromUniversal(
    row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  );

  return {
    id: String(row.id ?? row.requestKey ?? ""),
    sourceType,
    originalText: String(row.originalText ?? ""),
    normalizedText: String(row.normalizedText ?? ""),
    informationKinds: Array.isArray(row.informationKinds)
      ? row.informationKinds.map(String)
      : [],
    status: String(row.status ?? "received"),
    time: formatTime(row.createdAt ?? row.updatedAt),
    extractedItems,
    entities,
    relationships,
    executionSummary: executionSummaryText(row.executionSummary),
  };
}
