import { mapTask } from "../mappers/taskMapper.js";

/**
 * Tasks fail closed: return only rows whose metadata.userId (or equivalent)
 * equals the validated Telegram user ID at query level.
 *
 * If ownership cannot be enforced via deps.listTasksForUserFn, return [].
 */
export function createTasksReader(deps = {}) {
  return {
    /**
     * @returns {Promise<{ items: object[], meta: object, reason?: string }>}
     */
    async list(actor, { limit = 20, offset = 0 } = {}) {
      if (typeof deps.listTasksForUserFn !== "function") {
        return {
          items: [],
          meta: { limit, offset, hasMore: false },
          reason: "ownership_not_available",
        };
      }

      const rows = await deps.listTasksForUserFn(actor, { limit: limit + 1, offset });
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
          row.title != null && row.group != null ? row : mapTask(row)
        ),
        meta: { limit, offset, hasMore },
      };
    },
  };
}
