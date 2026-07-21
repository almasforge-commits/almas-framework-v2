/**
 * Injectable in-memory navigation context store (v1).
 * Keyed by actorKey + chatId. One active context per key.
 */

import {
  buildNavigationContextKey,
  createNavigationContext,
  isNavigationContextActive,
} from "./navigationContracts.js";

/**
 * @param {object} [options]
 * @param {Map} [options.map]
 * @param {() => number} [options.nowFn]
 * @param {number} [options.ttlMs]
 */
export function createNavigationContextStore(options = {}) {
  const map = options.map || new Map();
  const nowFn = options.nowFn || (() => Date.now());
  const defaultTtlMs = options.ttlMs;

  return {
    /**
     * @param {string} actorKey
     * @param {string|number|null} chatId
     * @param {object} partial
     * @returns {object|null}
     */
    set(actorKey, chatId, partial = {}) {
      if (!String(actorKey || "").trim()) return null;
      const key = buildNavigationContextKey(actorKey, chatId);

      const ctx = createNavigationContext({
        ...partial,
        nowMs: nowFn(),
        ttlMs: partial.ttlMs ?? defaultTtlMs,
      });
      if (!ctx) return null;
      map.set(key, ctx);
      return ctx;
    },

    /**
     * @param {string} actorKey
     * @param {string|number|null} chatId
     * @returns {object|null}
     */
    get(actorKey, chatId) {
      const key = buildNavigationContextKey(actorKey, chatId);
      const ctx = map.get(key) || null;
      if (!isNavigationContextActive(ctx, nowFn())) {
        if (ctx) map.delete(key);
        return null;
      }
      return ctx;
    },

    /**
     * Peek without deleting expired (still returns null if expired).
     */
    peek(actorKey, chatId) {
      return this.get(actorKey, chatId);
    },

    /**
     * @param {string} actorKey
     * @param {string|number|null} chatId
     * @param {object} patch
     * @returns {object|null}
     */
    update(actorKey, chatId, patch = {}) {
      const current = this.get(actorKey, chatId);
      if (!current) return null;
      return this.set(actorKey, chatId, {
        ...current,
        ...patch,
        items: patch.items ?? current.items,
        meta: { ...current.meta, ...(patch.meta || {}) },
        // Preserve original createdAt; refresh expiry.
        createdAt: current.createdAt,
      });
    },

    clear(actorKey, chatId) {
      const key = buildNavigationContextKey(actorKey, chatId);
      map.delete(key);
    },

    /** Test helper */
    clearAll() {
      map.clear();
    },

    size() {
      return map.size;
    },
  };
}

/** Process-wide default store (tests can inject their own). */
export const defaultNavigationContextStore = createNavigationContextStore();
