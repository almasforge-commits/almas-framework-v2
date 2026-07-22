/**
 * In-memory FX rate cache (process-local).
 * Keyed by source|base|quote|dayBucket.
 */

const store = new Map();

function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export function makeFxCacheKey(source, base, quote, at) {
  return `${source}|${String(base).toUpperCase()}|${String(quote).toUpperCase()}|${dayKey(at)}`;
}

/**
 * @param {string} key
 * @param {number} [maxAgeMs]
 */
export function getCachedFxRate(key, maxAgeMs = 6 * 60 * 60 * 1000) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > maxAgeMs) {
    store.delete(key);
    return null;
  }
  return { ...hit.value, cacheHit: true };
}

export function setCachedFxRate(key, value) {
  store.set(key, { cachedAt: Date.now(), value });
}

/** Test helper */
export function clearFxCache() {
  store.clear();
}
