/**
 * Official RSS/Atom World Knowledge provider (D-029).
 * Fetches only allowlisted HTTPS feeds. No scraping. No LLM. No PK writes.
 */

import { createProviderResult } from "../providerContracts.js";
import {
  assertFeedUrlAllowed,
  isAllowedFeedContentType,
  looksLikeHtmlDocument,
  rejectUserSuppliedFeedUrl,
} from "./feedUrlGuard.js";
import { parseFeedXml, sanitizeFeedText } from "./feedXmlParser.js";
import {
  getWorldKnowledgeFeeds,
  listEnabledFeeds,
} from "../../../config/worldKnowledgeFeeds.js";
import { getWorldKnowledgeConfig } from "../../../config/worldKnowledge.js";

export const OFFICIAL_FEED_PROVIDER_ID = "official_feeds";

const MIN_RELEVANCE = 0.22;

/**
 * @param {object} [deps]
 */
export function createOfficialFeedProvider(deps = {}) {
  const id = OFFICIAL_FEED_PROVIDER_ID;
  const nowFn = deps.nowFn ?? (() => Date.now());
  const fetchFn = deps.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const logger = deps.logger || { log() {}, error() {} };
  const allowIpHosts = deps.allowIpHosts === true;

  const config = {
    ...getWorldKnowledgeConfig(deps.env ?? {}),
    ...(deps.config || {}),
  };

  const feedTimeoutMs = config.feedTimeoutMs ?? 4_000;
  const feedMaxBytes = config.feedMaxBytes ?? 512_000;
  const feedMaxItems = config.feedMaxItems ?? 12;
  const feedMaxAgeDays = config.feedMaxAgeDays ?? 30;
  const feedCacheTtlMs = deps.feedCacheTtlMs ?? config.cacheTtlMs ?? 60_000;

  /** @type {Map<string, { expires: number, body: string, contentType: string }>} */
  const feedCache = deps.feedCache ?? new Map();

  let feeds = [];
  let ready = false;
  let lastErrors = [];

  function setFeeds(registry) {
    feeds = listEnabledFeeds(registry ?? deps.feeds ?? getWorldKnowledgeFeeds());
  }

  setFeeds(deps.feeds);

  const allowlist = () => new Set(feeds.map((f) => f.url));

  async function initialize() {
    setFeeds(deps.feeds);
    ready = true;
  }

  async function shutdown() {
    ready = false;
    feedCache.clear();
    lastErrors = [];
  }

  async function health() {
    return {
      ok: ready,
      provider: id,
      enabledFeeds: feeds.length,
      lastErrorCount: lastErrors.length,
    };
  }

  /**
   * @param {string} query
   * @param {object} [options]
   */
  async function search(query, options = {}) {
    if (!ready) {
      const err = new Error("provider_unavailable");
      err.code = "provider_unavailable";
      err.provider = id;
      throw err;
    }

    // Never accept user-supplied feed URLs.
    if (options.feedUrl || options.url || options.arbitraryUrl) {
      rejectUserSuppliedFeedUrl(
        options.feedUrl || options.url || options.arbitraryUrl
      );
      return [];
    }

    const q = String(query ?? "").trim();
    const limit = Number.isFinite(options.limit)
      ? Math.min(options.limit, feedMaxItems)
      : feedMaxItems;
    const language = options.language
      ? String(options.language).toLowerCase()
      : null;

    lastErrors = [];
    if (!feeds.length) {
      return [];
    }

    const maxAgeMs = feedMaxAgeDays * 24 * 60 * 60 * 1000;
    const now = nowFn();
    const collected = [];

    await Promise.all(
      feeds.map(async (feed) => {
        try {
          const rows = await searchOneFeed(feed, {
            query: q,
            language,
            now,
            maxAgeMs,
          });
          collected.push(...rows);
        } catch (error) {
          const reason = sanitizeReason(error?.code || error?.reason || "feed_unavailable");
          lastErrors.push({ feedId: feed.id, reason });
          logger.log?.(
            `[world-knowledge:feed] feed_failed reason=${reason}`
          );
        }
      })
    );

    const ranked = stableRank(collected).slice(0, limit);
    return ranked.map((row) =>
      createProviderResult({
        provider: id,
        title: row.title,
        summary: row.summary,
        url: row.url,
        publishedAt: row.publishedAt,
        language: row.language,
        author: row.author,
        confidence: row.confidence,
        sourceType: row.sourceType,
        metadata: {
          feedId: row.feedId,
          feedTitle: row.feedTitle,
          organization: row.organization,
          entryId: row.entryId,
          topics: row.topics,
        },
      })
    );
  }

  async function searchOneFeed(feed, ctx) {
    const allowed = assertFeedUrlAllowed(feed.url, {
      allowlist: allowlist(),
      allowIpHosts,
    });
    if (!allowed.ok) {
      const err = new Error("feed_not_allowed");
      err.code = "feed_not_allowed";
      throw err;
    }

    const { body, contentType } = await fetchFeedDocument(allowed.url);
    if (!isAllowedFeedContentType(contentType)) {
      const err = new Error("feed_invalid_content_type");
      err.code = "feed_invalid_content_type";
      throw err;
    }
    if (looksLikeHtmlDocument(body)) {
      const err = new Error("feed_invalid_content_type");
      err.code = "feed_invalid_content_type";
      throw err;
    }

    let parsed;
    try {
      parsed = parseFeedXml(body);
    } catch {
      const err = new Error("feed_parse_failed");
      err.code = "feed_parse_failed";
      throw err;
    }

    if (parsed.format === "unknown") {
      const err = new Error("feed_parse_failed");
      err.code = "feed_parse_failed";
      throw err;
    }

    const tokens = tokenize(ctx.query);
    const out = [];
    for (const entry of parsed.entries) {
      if (!entry.title && !entry.summary) continue;
      if (
        entry.publishedAt != null &&
        Number.isFinite(entry.publishedAt) &&
        ctx.now - entry.publishedAt > ctx.maxAgeMs
      ) {
        continue;
      }

      if (
        ctx.language &&
        Array.isArray(feed.languages) &&
        feed.languages.length &&
        !feed.languages.includes(ctx.language) &&
        !feed.languages.includes("any")
      ) {
        // Soft filter: still allow if title/summary strongly match.
      }

      const relevance = scoreRelevance({
        tokens,
        title: entry.title,
        summary: entry.summary,
        topics: feed.topics,
        query: ctx.query,
      });
      if (relevance < MIN_RELEVANCE) continue;

      const confidence = clamp01(feed.trustScore * (0.55 + 0.45 * relevance));
      out.push({
        title: entry.title || feed.title,
        summary: entry.summary || entry.title || "",
        url: entry.url || feed.url,
        publishedAt: entry.publishedAt,
        language: feed.languages[0] || "en",
        author: entry.author || feed.organization,
        confidence,
        sourceType: feed.sourceType,
        feedId: feed.id,
        feedTitle: sanitizeFeedText(feed.title),
        organization: feed.organization,
        entryId: entry.entryId,
        topics: feed.topics,
        relevance,
        _sortPublished: entry.publishedAt ?? 0,
        _sortTitle: (entry.title || "").toLowerCase(),
      });
    }

    if (!out.length) {
      return [];
    }
    return out;
  }

  async function fetchFeedDocument(url) {
    const cached = feedCache.get(url);
    if (cached && cached.expires > nowFn()) {
      return { body: cached.body, contentType: cached.contentType };
    }

    if (typeof fetchFn !== "function") {
      const err = new Error("feed_unavailable");
      err.code = "feed_unavailable";
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), feedTimeoutMs);

    let response;
    try {
      response = await fetchFn(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1",
          "User-Agent": "ALMAS-WorldKnowledge/1.0",
        },
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === "AbortError") {
        const err = new Error("feed_timeout");
        err.code = "feed_timeout";
        throw err;
      }
      const err = new Error("feed_unavailable");
      err.code = "feed_unavailable";
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response || response.ok === false) {
      const err = new Error("feed_unavailable");
      err.code = "feed_unavailable";
      throw err;
    }

    // Re-check final URL if fetch implementation exposes it (no open redirects).
    if (response.url && response.url !== url) {
      const recheck = assertFeedUrlAllowed(response.url, {
        allowlist: allowlist(),
        allowIpHosts,
      });
      if (!recheck.ok || response.url.startsWith("http:") ) {
        const err = new Error("feed_not_allowed");
        err.code = "feed_not_allowed";
        throw err;
      }
    }

    const contentType = response.headers?.get?.("content-type") || "";
    const body = await readBodyLimited(response, feedMaxBytes);

    feedCache.set(url, {
      expires: nowFn() + feedCacheTtlMs,
      body,
      contentType,
    });

    return { body, contentType };
  }

  return {
    id,
    initialize,
    search,
    health,
    shutdown,
    /** test helpers */
    _getFeeds: () => feeds.slice(),
    _getLastErrors: () => lastErrors.slice(),
    _clearCache: () => feedCache.clear(),
  };
}

async function readBodyLimited(response, maxBytes) {
  if (typeof response.text === "function" && !response.body) {
    const text = await response.text();
    if (byteLength(text) > maxBytes) {
      const err = new Error("feed_too_large");
      err.code = "feed_too_large";
      throw err;
    }
    return text;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (byteLength(text) > maxBytes) {
      const err = new Error("feed_too_large");
      err.code = "feed_too_large";
      throw err;
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
    total += chunk.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      const err = new Error("feed_too_large");
      err.code = "feed_too_large";
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function byteLength(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

function tokenize(query) {
  return String(query ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 24);
}

function scoreRelevance({ tokens, title, summary, topics, query }) {
  if (!tokens.length) return 0;
  const titleL = String(title ?? "").toLowerCase();
  const summaryL = String(summary ?? "").toLowerCase();
  const topicL = (topics || []).map((t) => String(t).toLowerCase());
  const q = String(query ?? "").toLowerCase();

  let titleOrSummaryHits = 0;
  let weight = 0;
  for (const token of tokens) {
    let inText = false;
    if (titleL.includes(token)) {
      titleOrSummaryHits += 1;
      weight += 1.0;
      inText = true;
    }
    if (summaryL.includes(token)) {
      titleOrSummaryHits += 1;
      weight += 0.55;
      inText = true;
    }
    if (topicL.some((t) => t.includes(token) || token.includes(t))) {
      weight += inText ? 0.35 : 0.15;
    }
  }

  // Require at least one title/summary token hit — topics alone are insufficient.
  if (titleOrSummaryHits === 0) return 0;

  if (q && titleL.includes(q)) weight += 0.35;
  return clamp01(weight / Math.max(tokens.length, 1));
}

function stableRank(rows) {
  return rows.slice().sort((a, b) => {
    const rb = b.relevance - a.relevance;
    if (Math.abs(rb) > 1e-9) return rb > 0 ? 1 : -1;
    const pb = (b._sortPublished || 0) - (a._sortPublished || 0);
    if (pb !== 0) return pb > 0 ? 1 : -1;
    if (a._sortTitle < b._sortTitle) return -1;
    if (a._sortTitle > b._sortTitle) return 1;
    const ida = String(a.entryId || "");
    const idb = String(b.entryId || "");
    if (ida < idb) return -1;
    if (ida > idb) return 1;
    return 0;
  });
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return Math.round(x * 1000) / 1000;
}

function sanitizeReason(code) {
  const allowed = new Set([
    "feed_timeout",
    "feed_unavailable",
    "feed_invalid_content_type",
    "feed_too_large",
    "feed_parse_failed",
    "feed_not_allowed",
    "no_relevant_items",
  ]);
  const c = String(code ?? "feed_unavailable");
  return allowed.has(c) ? c : "feed_unavailable";
}
