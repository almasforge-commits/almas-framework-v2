/**
 * Personal Knowledge config — hardcoded defaults.
 * May read process.env if present; never requires .env changes.
 */

import { DEFAULT_CONFIDENCE_THRESHOLD } from "../services/personalKnowledge/personalKnowledgeContracts.js";

export function getPersonalKnowledgeConfig(env = process.env) {
  const rawThreshold = env?.PERSONAL_KNOWLEDGE_CONFIDENCE_THRESHOLD;
  let confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD;
  if (rawThreshold != null && String(rawThreshold).trim() !== "") {
    const n = Number(rawThreshold);
    if (Number.isFinite(n) && n >= 0 && n <= 1) {
      confidenceThreshold = n;
    }
  }

  const enabledRaw = String(env?.PERSONAL_KNOWLEDGE_ENABLED ?? "false")
    .trim()
    .toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1";

  return Object.freeze({
    enabled,
    confidenceThreshold,
    maxStoreEntries: 2000,
    // v1 is shadow-ingest only when enabled (no active domain writes).
    shadowIngest: true,
  });
}
