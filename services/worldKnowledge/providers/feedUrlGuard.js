/**
 * SSRF / allowlist guards for Official Feed Provider (D-029).
 * Never fetches user-supplied URLs.
 */

const PRIVATE_HOST_RE =
  /^(localhost|localhost\.localdomain|metadata\.google\.internal)$/i;

const PRIVATE_IPV4_RE =
  /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|100\.64\.|100\.65\.|100\.66\.|100\.67\.|100\.68\.|100\.69\.|100\.70\.|100\.71\.|100\.72\.|100\.73\.|100\.74\.|100\.75\.|100\.76\.|100\.77\.|100\.78\.|100\.79\.|100\.80\.|100\.81\.|100\.82\.|100\.83\.|100\.84\.|100\.85\.|100\.86\.|100\.87\.|100\.88\.|100\.89\.|100\.90\.|100\.91\.|100\.92\.|100\.93\.|100\.94\.|100\.95\.|100\.96\.|100\.97\.|100\.98\.|100\.99\.|100\.100\.|100\.101\.|100\.102\.|100\.103\.|100\.104\.|100\.105\.|100\.106\.|100\.107\.|100\.108\.|100\.109\.|100\.110\.|100\.111\.|100\.112\.|100\.113\.|100\.114\.|100\.115\.|100\.116\.|100\.117\.|100\.118\.|100\.119\.|100\.120\.|100\.121\.|100\.122\.|100\.123\.|100\.124\.|100\.125\.|100\.126\.|100\.127\.)/;

const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_HINT = /:|^\[.*\]$/;

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.allowlist]
 * @param {boolean} [opts.allowIpHosts] — tests only
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function assertFeedUrlAllowed(url, opts = {}) {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return { ok: false, reason: "feed_not_allowed" };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "feed_not_allowed" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "feed_not_allowed" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "feed_not_allowed" };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || PRIVATE_HOST_RE.test(host)) {
    return { ok: false, reason: "feed_not_allowed" };
  }

  const isIp = IPV4_LITERAL.test(host) || IPV6_HINT.test(host);
  if (isIp && opts.allowIpHosts !== true) {
    return { ok: false, reason: "feed_not_allowed" };
  }

  if (IPV4_LITERAL.test(host)) {
    if (isPrivateIpv4(host)) {
      return { ok: false, reason: "feed_not_allowed" };
    }
  }

  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return { ok: false, reason: "feed_not_allowed" };
  }

  const allowlist = toAllowSet(opts.allowlist);
  if (allowlist && !allowlist.has(raw) && !allowlist.has(parsed.href)) {
    // Exact allowlist match only — no wildcards, no query-time construction.
    return { ok: false, reason: "feed_not_allowed" };
  }

  return { ok: true, url: parsed.href };
}

/**
 * Reject arbitrary user-supplied fetch targets (never used for feed fetch).
 * @param {string} url
 */
export function rejectUserSuppliedFeedUrl(url) {
  return {
    ok: false,
    reason: "feed_not_allowed",
    message: "user_url_rejected",
    url: String(url ?? "").slice(0, 0),
  };
}

/**
 * @param {string} contentType
 */
export function isAllowedFeedContentType(contentType) {
  const ct = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ct) return false;
  return (
    ct === "application/rss+xml" ||
    ct === "application/atom+xml" ||
    ct === "application/xml" ||
    ct === "text/xml" ||
    ct === "application/rdf+xml" ||
    ct === "text/plain"
  );
}

/**
 * Heuristic: HTML document masquerading as a feed.
 * @param {string} body
 */
export function looksLikeHtmlDocument(body) {
  const head = String(body ?? "")
    .slice(0, 800)
    .toLowerCase();
  if (/<(rss|feed|rdf:rdf)\b/.test(head)) return false;
  return /<!doctype\s+html\b/.test(head) || /<html\b/.test(head);
}

function toAllowSet(allowlist) {
  if (!allowlist) return null;
  if (allowlist instanceof Set) return allowlist;
  if (Array.isArray(allowlist)) return new Set(allowlist.map(String));
  return null;
}

function isPrivateIpv4(host) {
  if (PRIVATE_IPV4_RE.test(host)) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = parts;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
