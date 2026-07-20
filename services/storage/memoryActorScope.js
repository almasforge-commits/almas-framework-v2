/**
 * Actor identity helpers for legacy Memory rows.
 * Supports metadata.userId / user_id / chatId / chat_id without schema changes.
 */

/**
 * Normalize Telegram actor id from actorKey or userId.
 * "telegram:394476106" → "394476106"
 * @param {object} [options]
 * @returns {string|null}
 */
export function normalizeTelegramActorId(options = {}) {
  if (options.userId != null && String(options.userId).trim() !== "") {
    return String(options.userId)
      .trim()
      .replace(/^telegram:/i, "")
      .trim() || null;
  }
  const key = String(options.actorKey ?? "").trim();
  if (!key) return null;
  return key.replace(/^telegram:/i, "").trim() || null;
}

/**
 * Owner id candidates from a memory metadata object (stringified, no telegram: prefix).
 * @param {object|null|undefined} metadata
 * @returns {string[]}
 */
export function extractMemoryOwnerIds(metadata) {
  if (!metadata || typeof metadata !== "object") return [];
  const out = [];
  for (const key of ["userId", "user_id", "chatId", "chat_id"]) {
    if (metadata[key] == null || metadata[key] === "") continue;
    const id = String(metadata[key])
      .trim()
      .replace(/^telegram:/i, "")
      .trim();
    if (id) out.push(id);
  }
  return out;
}

/**
 * @param {object} row
 * @returns {boolean}
 */
export function memoryRowHasOwnerMeta(row) {
  return extractMemoryOwnerIds(row?.metadata).length > 0;
}

/**
 * Keep only memories owned by the Telegram actor when userId/actorKey given.
 * Rows without ownership metadata are excluded (fail closed).
 *
 * @param {object[]} rows
 * @param {object} [options]
 * @returns {object[]}
 */
export function filterMemoriesByActor(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const userIdRaw = normalizeTelegramActorId(options);
  if (!userIdRaw) return rows;

  return rows.filter((row) => {
    const owners = extractMemoryOwnerIds(
      row?.metadata && typeof row.metadata === "object" ? row.metadata : null
    );
    if (owners.length === 0) return false;
    return owners.includes(userIdRaw);
  });
}
