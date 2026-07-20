/**
 * Explicit static Official RSS/Atom feed registry (D-029).
 * Default list is empty until verified official HTTPS feeds are curated.
 * Tests inject fixtures; production never invents URLs.
 */

import { WORLD_SOURCE_TYPES } from "../services/worldKnowledge/providerContracts.js";

/**
 * Curated official feeds. Kept empty by design until URLs are verified offline.
 * Do not invent entries.
 * @type {ReadonlyArray<object>}
 */
export const DEFAULT_WORLD_KNOWLEDGE_FEEDS = Object.freeze([]);

/**
 * @param {object[]} [feeds]
 * @returns {ReadonlyArray<object>}
 */
export function getWorldKnowledgeFeeds(feeds = DEFAULT_WORLD_KNOWLEDGE_FEEDS) {
  return Object.freeze(validateFeedRegistry(feeds));
}

/**
 * Validate and normalize a feed registry. Rejects duplicates / bad URLs / types.
 * @param {unknown} feeds
 * @returns {object[]}
 */
export function validateFeedRegistry(feeds) {
  if (!Array.isArray(feeds)) {
    throw new Error("feed_registry_invalid");
  }

  const seenIds = new Set();
  const seenUrls = new Set();
  const out = [];

  for (const raw of feeds) {
    if (!raw || typeof raw !== "object") {
      throw new Error("feed_entry_invalid");
    }

    const id = String(raw.id ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const url = String(raw.url ?? "").trim();
    const organization = String(raw.organization ?? "").trim();
    const sourceType = String(raw.sourceType ?? "news").trim();
    const trustScore = clamp01(raw.trustScore ?? 0.7);
    const topics = normalizeStringList(raw.topics);
    const languages = normalizeStringList(raw.languages).map((l) =>
      l.toLowerCase()
    );
    const enabled = raw.enabled !== false;

    if (!id || !title || !url || !organization) {
      throw new Error("feed_entry_incomplete");
    }
    if (seenIds.has(id)) {
      throw new Error("feed_duplicate_id");
    }
    if (seenUrls.has(url)) {
      throw new Error("feed_duplicate_url");
    }
    if (!WORLD_SOURCE_TYPES.includes(sourceType)) {
      throw new Error("feed_invalid_source_type");
    }
    if (!isHttpsUrl(url)) {
      throw new Error("feed_url_must_be_https");
    }

    seenIds.add(id);
    seenUrls.add(url);

    out.push(
      Object.freeze({
        id,
        title,
        url,
        organization,
        sourceType,
        trustScore,
        topics: Object.freeze(topics),
        languages: Object.freeze(languages.length ? languages : ["en"]),
        enabled,
      })
    );
  }

  return out;
}

/**
 * @param {object[]} feeds
 * @returns {object[]}
 */
export function listEnabledFeeds(feeds) {
  return validateFeedRegistry(feeds).filter((f) => f.enabled === true);
}

function isHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 32);
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return Math.round(x * 1000) / 1000;
}
