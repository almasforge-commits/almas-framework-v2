/**
 * Telegram navigation context contracts — pure, no I/O.
 */

export const NAV_SECTIONS = Object.freeze([
  "knowledge",
  "ideas",
  "tasks",
  "memory",
  "finance",
]);

export const NAV_SCREENS = Object.freeze(["list", "item", "summary"]);

/** Default TTL: 15 minutes. */
export const NAV_CONTEXT_TTL_MS = 15 * 60 * 1000;

/**
 * @param {string} actorKey
 * @param {string|number|null} chatId
 * @returns {string}
 */
export function buildNavigationContextKey(actorKey, chatId) {
  const actor = String(actorKey ?? "").trim();
  const chat = chatId == null ? "" : String(chatId).trim();
  return `${actor}::${chat}`;
}

/**
 * @param {object} input
 * @returns {object|null}
 */
export function createNavigationContext(input = {}) {
  const section = String(input.section ?? "").trim().toLowerCase();
  if (!NAV_SECTIONS.includes(section)) return null;

  const now = Number(input.nowMs) || Date.now();
  const rawTtl = Number(input.ttlMs);
  const ttl =
    Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : NAV_CONTEXT_TTL_MS;
  const items = normalizeNavItems(input.items);

  return {
    section,
    screen: NAV_SCREENS.includes(input.screen) ? input.screen : "list",
    items,
    page: Number.isFinite(Number(input.page)) ? Number(input.page) : 0,
    cursor: Number.isFinite(Number(input.cursor))
      ? Number(input.cursor)
      : null,
    createdAt: now,
    expiresAt: now + ttl,
    meta:
      input.meta && typeof input.meta === "object" ? { ...input.meta } : {},
  };
}

/**
 * @param {object|null} ctx
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isNavigationContextActive(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!NAV_SECTIONS.includes(ctx.section)) return false;
  return Number(ctx.expiresAt) > Number(nowMs);
}

/**
 * @param {unknown} items
 * @returns {object[]}
 */
export function normalizeNavItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const index = Number(item.index);
      return {
        index: Number.isFinite(index) && index >= 1 ? index : i + 1,
        id: item.id != null ? String(item.id) : null,
        title: item.title != null ? String(item.title).slice(0, 200) : null,
        content:
          item.content != null ? String(item.content).slice(0, 500) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}
