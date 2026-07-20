import { buildContextKey } from "./contextContracts.js";

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_REQUEST_KEYS = 500;

/**
 * In-memory pending clarification store.
 * One active clarification per (actorKey, chatId). Injectable for tests.
 *
 * API: get / set / update / clear / expire / idempotency by requestKey.
 */
export function createConversationContextStore(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries)
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES;
  const maxRequestKeys = Number.isFinite(options.maxRequestKeys)
    ? options.maxRequestKeys
    : DEFAULT_MAX_REQUEST_KEYS;

  /** @type {Map<string, object>} */
  const entries = new Map();
  /** @type {Map<string, number>} requestKey → processedAt */
  const processedRequestKeys = new Map();

  function touch(key, value) {
    if (entries.has(key)) entries.delete(key);
    entries.set(key, value);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  }

  function rememberRequestKey(requestKey, nowMs = Date.now()) {
    if (!requestKey) return;
    const key = String(requestKey);
    if (processedRequestKeys.has(key)) processedRequestKeys.delete(key);
    processedRequestKeys.set(key, nowMs);
    while (processedRequestKeys.size > maxRequestKeys) {
      const oldest = processedRequestKeys.keys().next().value;
      processedRequestKeys.delete(oldest);
    }
  }

  return {
    /**
     * @param {string} actorKey
     * @param {number|string|null} chatId
     * @param {number} [nowMs]
     */
    get(actorKey, chatId, nowMs = Date.now()) {
      const key = buildContextKey(actorKey, chatId);
      const pending = entries.get(key);
      if (!pending) return null;
      if (pending.expiresAt <= nowMs || pending.status !== "pending") {
        entries.delete(key);
        return null;
      }
      return pending;
    },

    /**
     * Replaces any existing pending clarification for this actor+chat.
     * @param {object} pending
     */
    set(pending) {
      const key = buildContextKey(pending.actorKey, pending.chatId);
      touch(key, pending);
      return pending;
    },

    /**
     * Shallow-merge patch into existing pending (if still valid).
     * @param {string} actorKey
     * @param {number|string|null} chatId
     * @param {object} patch
     * @param {number} [nowMs]
     */
    update(actorKey, chatId, patch = {}, nowMs = Date.now()) {
      const current = this.get(actorKey, chatId, nowMs);
      if (!current) return null;
      const next = {
        ...current,
        ...patch,
        draft:
          patch.draft && typeof patch.draft === "object"
            ? {
                type: patch.draft.type ?? current.draft?.type,
                payload: {
                  ...(current.draft?.payload || {}),
                  ...(patch.draft.payload || {}),
                },
              }
            : current.draft,
        missingFields: Array.isArray(patch.missingFields)
          ? patch.missingFields
          : current.missingFields,
      };
      return this.set(next);
    },

    /**
     * @param {string} actorKey
     * @param {number|string|null} chatId
     */
    clear(actorKey, chatId) {
      const key = buildContextKey(actorKey, chatId);
      entries.delete(key);
    },

    /**
     * Force-expire and remove pending for actor+chat.
     * @param {string} actorKey
     * @param {number|string|null} chatId
     */
    expire(actorKey, chatId) {
      this.clear(actorKey, chatId);
    },

    /**
     * @param {string|null|undefined} requestKey
     */
    hasProcessedRequestKey(requestKey) {
      if (!requestKey) return false;
      return processedRequestKeys.has(String(requestKey));
    },

    /**
     * @param {string|null|undefined} requestKey
     * @param {number} [nowMs]
     */
    markProcessedRequestKey(requestKey, nowMs = Date.now()) {
      rememberRequestKey(requestKey, nowMs);
    },

    size() {
      return entries.size;
    },

    /** Test helper */
    clearAll() {
      entries.clear();
      processedRequestKeys.clear();
    },
  };
}

/** Process-local default store (same pattern as actionExecutor idempotency). */
export const defaultConversationContextStore = createConversationContextStore();

/** Test helper */
export function resetConversationContextStoreForTests() {
  defaultConversationContextStore.clearAll();
}
