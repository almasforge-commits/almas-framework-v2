import { mapTask } from "../mappers/taskMapper.js";

/**
 * Tasks fail closed: return only rows whose metadata.userId (or equivalent)
 * equals the validated Telegram user ID at query level.
 */
export function createTasksReader(deps = {}) {
  return {
    async list(actor, { limit = 20, offset = 0 } = {}) {
      if (typeof deps.listTasksForUserFn !== "function") {
        return {
          items: [],
          meta: { limit, offset, hasMore: false },
          reason: "ownership_not_available",
        };
      }

      const rows = await deps.listTasksForUserFn(actor, {
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
          row.title != null && row.group != null ? row : mapTask(row)
        ),
        meta: { limit, offset, hasMore },
      };
    },

    /**
     * Actor-scoped complete/reopen.
     * @returns {Promise<object|null>}
     */
    async patch(actor, taskId, { completed } = {}) {
      if (typeof deps.updateTaskStatusFn !== "function") return null;
      const userId =
        actor?.userId ||
        (actor?.telegramUserId != null ? String(actor.telegramUserId) : null);
      if (!userId) return null;

      const status = completed ? "done" : "active";
      const row = await deps.updateTaskStatusFn(taskId, status, { userId });
      if (!row) return null;
      return mapTask(row);
    },
  };
}
