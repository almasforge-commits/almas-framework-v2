/**
 * Parse ALMAS_API_CORS_ORIGIN allowlist (comma-separated).
 * No wildcard. No reflective Origin.
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function parseCorsAllowlist(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((origin) => origin !== "*");
}

/**
 * @param {string[]} allowlist
 * @param {string|undefined} requestOrigin
 */
export function resolveCorsOrigin(allowlist, requestOrigin) {
  if (!allowlist.length || !requestOrigin) return null;
  return allowlist.includes(requestOrigin) ? requestOrigin : null;
}
