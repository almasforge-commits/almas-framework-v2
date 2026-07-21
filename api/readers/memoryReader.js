/**
 * Memory reader for Mini App — reuses listMemoriesForActor via injected deps.
 * No static import of memoryService (keeps API write/execution boundary).
 */

function actorUserId(actor) {
  if (actor?.telegramUserId != null) return String(actor.telegramUserId);
  const key = String(actor?.actorKey || "");
  const m = key.match(/^telegram:(.+)$/i);
  return m ? m[1] : null;
}

function mapMemory(row) {
  if (!row) return null;
  const content = String(row.content || row.text || "").trim();
  if (!content) return null;
  return {
    id: row.id != null ? String(row.id) : null,
    content,
    createdAt: row.created_at || row.createdAt || null,
    type: row.type || row.metadata?.memoryType || null,
  };
}

/**
 * @param {object} [deps]
 */
export function createMemoryReader(deps = {}) {
  const listFn = deps.listMemoriesForUserFn;

  return {
    async list(actor, { limit = 40, offset = 0 } = {}) {
      const userId = actorUserId(actor);
      if (!userId || typeof listFn !== "function") {
        return {
          items: [],
          meta: { limit, offset, hasMore: false },
          reason: "ownership_not_available",
        };
      }

      const rows = await listFn(userId, {
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
        items: page.map(mapMemory).filter(Boolean),
        meta: { limit, offset, hasMore },
      };
    },
  };
}
