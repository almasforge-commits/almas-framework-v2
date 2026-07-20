/**
 * KnowledgeRepository interface — ingestion never writes drivers directly.
 */

export const KNOWLEDGE_REPOSITORY_METHODS = Object.freeze([
  "upsert",
  "getById",
  "list",
  "clear",
  "size",
]);

export function isKnowledgeRepository(repo) {
  if (!repo || typeof repo !== "object") return false;
  return KNOWLEDGE_REPOSITORY_METHODS.every(
    (m) => typeof repo[m] === "function"
  );
}

export function assertKnowledgeRepository(repo) {
  if (!isKnowledgeRepository(repo)) {
    throw new Error("invalid_knowledge_repository");
  }
  return repo;
}
