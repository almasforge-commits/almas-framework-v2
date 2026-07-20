/**
 * Universal Knowledge Ingestion config — safe defaults.
 * May read process.env; never requires .env edits.
 */

export function getIngestionConfig(env = process.env) {
  const modeRaw = String(env?.INGESTION_MODE ?? "shadow")
    .trim()
    .toLowerCase();
  const mode = ["dry_run", "shadow", "active"].includes(modeRaw)
    ? modeRaw
    : "shadow";

  return Object.freeze({
    mode,
    chunkSize: parsePositiveInt(env?.INGESTION_CHUNK_SIZE, 2000),
    chunkOverlap: parsePositiveInt(env?.INGESTION_CHUNK_OVERLAP, 200),
    maxContentChars: parsePositiveInt(env?.INGESTION_MAX_CONTENT, 500_000),
    runUniversalExtraction: env?.INGESTION_UNIVERSAL_EXTRACTION !== "false",
    runEntityExtraction: env?.INGESTION_ENTITY_EXTRACTION !== "false",
    runRelationshipExtraction:
      env?.INGESTION_RELATIONSHIP_EXTRACTION !== "false",
    /** Never auto-write Personal Knowledge in this milestone. */
    writePersonalKnowledge: false,
  });
}

function parsePositiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
