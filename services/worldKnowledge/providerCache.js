/**
 * Injectable in-memory World Knowledge cache with TTL.
 */

/**
 * @param {object} [options]
 * @param {number} [options.defaultTtlMs]
 * @param {Function} [options.nowFn]
 */
export function createInMemoryWorldCache(options = {}) {
  const defaultTtlMs = Number.isFinite(options.defaultTtlMs)
    ? options.defaultTtlMs
    : 60_000;
  const nowFn = options.nowFn ?? (() => Date.now());

  /** @type {Map<string, { value: unknown, expiresAt: number }>} */
  const store = new Map();

  return {
    /**
     * @param {string} key
     */
    get(key) {
      const k = String(key ?? "");
      if (!k) return null;
      const row = store.get(k);
      if (!row) return null;
      if (row.expiresAt <= nowFn()) {
        store.delete(k);
        return null;
      }
      return row.value;
    },

    /**
     * @param {string} key
     * @param {unknown} value
     * @param {number} [ttlMs]
     */
    set(key, value, ttlMs) {
      const k = String(key ?? "");
      if (!k) return false;
      const ttl = Number.isFinite(ttlMs) ? ttlMs : defaultTtlMs;
      store.set(k, {
        value,
        expiresAt: nowFn() + Math.max(0, ttl),
      });
      return true;
    },

    clear() {
      store.clear();
    },

    size() {
      return store.size;
    },
  };
}
