/**
 * Read-only World Knowledge adapter.
 * Never writes into the personal store. Always attaches provenance.
 */

import {
  WORLD_SCOPE,
  createRetrievalHit,
} from "./personalKnowledgeContracts.js";

/**
 * @param {object} [deps]
 * @param {Function} [deps.searchWorldFn] - async (query, opts) => hits[]
 */
export function createWorldKnowledgeAdapter(deps = {}) {
  const searchWorldFn =
    typeof deps.searchWorldFn === "function"
      ? deps.searchWorldFn
      : async () => [];

  return {
    /**
     * @param {string} query
     * @param {object} [opts]
     * @returns {Promise<object[]>} retrieval hits with scope=world
     */
    async search(query, opts = {}) {
      const q = String(query ?? "").trim();
      if (!q) return [];

      let raw = [];
      try {
        raw = await searchWorldFn(q, {
          limit: opts.limit ?? 10,
          actorKey: opts.actorKey ?? null,
        });
      } catch {
        // Provider failure → empty world results; never throw into personal path.
        console.log("[personal-knowledge] world search failed");
        return [];
      }

      if (!Array.isArray(raw)) return [];

      const now = Date.now();
      return raw
        .filter((item) => item && typeof item === "object")
        .map((item) =>
          createRetrievalHit({
            id: item.id ?? null,
            actorKey: opts.actorKey ?? null,
            domain: item.domain ?? "Knowledge",
            content: String(item.content ?? item.text ?? "").slice(0, 2000),
            confidence: item.confidence,
            scope: WORLD_SCOPE,
            provenance: {
              sourceType: item.sourceType ?? "world_provider",
              evidence: {
                quote: item.title ?? item.url ?? null,
                candidateKind: null,
              },
              provider: item.provider ?? "world_adapter",
              retrievedAt: now,
            },
          })
        )
        .filter((hit) => hit.content);
    },
  };
}

export const defaultWorldKnowledgeAdapter = createWorldKnowledgeAdapter();
