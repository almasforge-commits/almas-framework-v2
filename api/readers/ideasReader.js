import { mapIdea } from "../mappers/ideaMapper.js";

/**
 * Ideas fail closed: only list/get via ownership-scoped deps.
 */
export function createIdeasReader(deps = {}) {
  return {
    async list(actor, { limit = 20, offset = 0, category = null, q = null } = {}) {
      if (typeof deps.listIdeasForUserFn !== "function") {
        return {
          items: [],
          meta: { limit, offset, hasMore: false },
          reason: "ownership_not_available",
        };
      }

      const rows = await deps.listIdeasForUserFn(actor, {
        limit: limit + 1,
        offset,
        category,
        query: q,
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
        items: page.map((row) => mapIdea(row)).filter(Boolean),
        meta: { limit, offset, hasMore },
      };
    },

    async search(actor, { q = "", category = null, limit = 20 } = {}) {
      if (typeof deps.searchIdeasForUserFn === "function") {
        const rows = await deps.searchIdeasForUserFn(actor, {
          q,
          category,
          limit,
        });
        if (!Array.isArray(rows)) {
          return { items: [], meta: { limit, offset: 0, hasMore: false } };
        }
        return {
          items: rows.map((row) => mapIdea(row)).filter(Boolean),
          meta: { limit, offset: 0, hasMore: false },
        };
      }
      return this.list(actor, { limit, offset: 0, category, q });
    },

    async getById(actor, ideaId) {
      if (typeof deps.getIdeaForUserFn !== "function") {
        return { item: null, reason: "ownership_not_available" };
      }
      const row = await deps.getIdeaForUserFn(actor, ideaId);
      if (!row) return { item: null, reason: "not_found" };
      return { item: mapIdea(row) };
    },
  };
}
