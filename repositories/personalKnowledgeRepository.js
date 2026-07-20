/**
 * PersonalKnowledgeRepository — interface contract (no Supabase).
 *
 * Implementations:
 * - createPersonalKnowledgeStore / createInMemoryPersonalKnowledgeRepository
 * - createSupabasePersonalKnowledgeRepository
 *
 * Engines depend only on this surface via DI (`deps.store` / `deps.repository`).
 */

export const PERSONAL_KNOWLEDGE_REPOSITORY_METHODS = Object.freeze([
  "upsert",
  "getById",
  "listByActor",
  "listByDomain",
  "search",
  "clear",
  "size",
]);

/**
 * @param {object} repo
 * @returns {boolean}
 */
export function isPersonalKnowledgeRepository(repo) {
  if (!repo || typeof repo !== "object") return false;
  return PERSONAL_KNOWLEDGE_REPOSITORY_METHODS.every(
    (m) => typeof repo[m] === "function"
  );
}

/**
 * @param {object} repo
 */
export function assertPersonalKnowledgeRepository(repo) {
  if (!isPersonalKnowledgeRepository(repo)) {
    throw new Error("invalid_personal_knowledge_repository");
  }
  return repo;
}
