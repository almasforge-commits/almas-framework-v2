/**
 * ReasoningRepository — interface contract (no Supabase).
 *
 * Implementations:
 * - createReasoningStore / createInMemoryReasoningRepository
 * - createSupabaseReasoningRepository
 */

export const REASONING_REPOSITORY_METHODS = Object.freeze([
  "upsertInsight",
  "getInsight",
  "listInsights",
  "searchInsights",
  "deleteInsight",
  "upsertRecommendation",
  "listRecommendations",
  "searchRecommendations",
  "clear",
  "size",
]);

/**
 * @param {object} repo
 * @returns {boolean}
 */
export function isReasoningRepository(repo) {
  if (!repo || typeof repo !== "object") return false;
  return REASONING_REPOSITORY_METHODS.every(
    (m) => typeof repo[m] === "function"
  );
}

/**
 * @param {object} repo
 */
export function assertReasoningRepository(repo) {
  if (!isReasoningRepository(repo)) {
    throw new Error("invalid_reasoning_repository");
  }
  return repo;
}
