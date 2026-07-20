import { mapInboxItem } from "../mappers/inboxMapper.js";
import { HttpError } from "../httpErrors.js";

/**
 * Actor-scoped Inbox list.
 * Does NOT depend on INBOX_ENABLED — API is a reader.
 * actor_key is authoritative; telegram_user_id may be applied as an extra filter.
 *
 * [] only when the query succeeds with no rows.
 * Controlled 503 when the table/read fails.
 */
export function createInboxReader(deps = {}) {
  const listInboxItemsFn = deps.listInboxItemsFn;

  return {
    /**
     * @returns {Promise<{ items: object[], meta: object }>}
     */
    async list(actor, { limit = 20, offset = 0 } = {}) {
      if (typeof listInboxItemsFn !== "function") {
        throw new HttpError(
          503,
          "service_unavailable",
          "Inbox unavailable",
          "inbox_list_fn_missing"
        );
      }

      if (!actor?.actorKey || !actor?.telegramUserId) {
        throw new HttpError(401, "unauthorized", "Unauthorized", "missing_actor");
      }

      const fetchLimit = limit + 1;
      let rows;
      try {
        rows = await listInboxItemsFn(
          {
            actorKey: actor.actorKey,
            telegramUserId: actor.telegramUserId,
            limit: fetchLimit,
            offset,
          },
          deps
        );
      } catch (error) {
        throw new HttpError(
          503,
          "service_unavailable",
          "Inbox unavailable",
          "inbox_list_failed"
        );
      }

      if (!Array.isArray(rows)) {
        throw new HttpError(
          503,
          "service_unavailable",
          "Inbox unavailable",
          "inbox_list_invalid"
        );
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: page.map(mapInboxItem),
        meta: { limit, offset, hasMore },
      };
    },
  };
}
