import { mapKnowledgeItem } from "../mappers/knowledgeMapper.js";

/**
 * Knowledge fail closed: never return global knowledge.
 * If no actor ownership field / scoped query exists → [] with
 * internal reason ownership_not_available.
 */
export function createKnowledgeReader(deps = {}) {
  return {
    /**
     * @returns {Promise<{ items: object[], meta: object, reason?: string }>}
     */
    async list(actor, { limit = 20, offset = 0 } = {}) {
      if (typeof deps.listKnowledgeForUserFn !== "function") {
        return {
          items: [],
          meta: { limit, offset, hasMore: false },
          reason: "ownership_not_available",
        };
      }

      const rows = await deps.listKnowledgeForUserFn(actor, {
        limit: limit + 1,
        offset,
      });
      if (!Array.isArray(rows)) {
        return {
          items: [],
          meta: { limit, offset, hasMore: false },
          reason: "ownership_not_available",
        };
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: page.map((row) =>
          row.sourceType != null && row.title != null
            ? row
            : mapKnowledgeItem(row)
        ),
        meta: { limit, offset, hasMore },
      };
    },
  };
}
