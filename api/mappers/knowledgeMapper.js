const SOURCE_MAP = {
  youtube: "youtube",
  pdf: "pdf",
  note: "note",
  website: "website",
  web: "website",
};

export function mapKnowledgeItem(row) {
  const source =
    row?.metadata?.source?.type ||
    row?.source_type ||
    row?.sourceType ||
    "note";
  const sourceType = SOURCE_MAP[String(source).toLowerCase()] || "note";

  let createdAt = "";
  const raw = row.created_at || row.createdAt;
  if (raw) {
    try {
      createdAt = new Date(raw).toISOString().slice(0, 10);
    } catch {
      createdAt = String(raw).slice(0, 10);
    }
  }

  const tags = Array.isArray(row.tags)
    ? row.tags.map(String)
    : Array.isArray(row.metadata?.tags)
      ? row.metadata.tags.map(String)
      : [];

  return {
    id: String(row.id ?? ""),
    title: String(row.title || row.metadata?.source?.title || "Знание"),
    sourceType,
    summary: String(row.summary || row.content || "").slice(0, 500),
    tags,
    createdAt,
  };
}
