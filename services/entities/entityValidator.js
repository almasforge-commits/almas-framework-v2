import {
  ENTITY_TYPES,
  createEmptyEntityBag,
  isKnownEntityType,
} from "./entityContracts.js";

// Pure entity-bag validator. Never invents values. No I/O.

const MAX_VALUES_PER_TYPE = 20;
const MAX_STRING = 200;

function clipString(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.length > MAX_STRING ? text.slice(0, MAX_STRING) : text;
}

function normalizeValue(value, type) {
  if (type === "numbers") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value.replace(",", ".").replace(/\s/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return clipString(value);
  return null;
}

function dedupePreserveOrder(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const key = typeof item === "number" ? `n:${item}` : `s:${String(item).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Validates a raw entity bag. Unknown types dropped. Values clipped/deduped.
 * Never mutates caller input. Always returns a full bag (empty arrays OK).
 *
 * @param {unknown} raw
 * @param {object} [options]
 * @returns {Record<string, unknown[]>}
 */
export function validateEntityBag(raw, options = {}) {
  const maxPerType = options.maxValuesPerType ?? MAX_VALUES_PER_TYPE;
  const bag = createEmptyEntityBag();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bag;

  for (const type of ENTITY_TYPES) {
    const source = raw[type];
    if (!Array.isArray(source)) continue;
    const values = [];
    for (const entry of source.slice(0, maxPerType * 2)) {
      const normalized = normalizeValue(entry, type);
      if (normalized == null) continue;
      values.push(normalized);
      if (values.length >= maxPerType) break;
    }
    bag[type] = dedupePreserveOrder(values);
  }

  return bag;
}

/**
 * Picks only known entity-type keys from a mixed entities object
 * (domain fields like amount/title are ignored here).
 *
 * @param {object} entities
 * @returns {Record<string, unknown[]>}
 */
export function pickUniversalEntityBag(entities) {
  if (!entities || typeof entities !== "object") return createEmptyEntityBag();
  const raw = {};
  for (const [key, value] of Object.entries(entities)) {
    if (!isKnownEntityType(key)) continue;
    raw[key] = value;
  }
  return validateEntityBag(raw);
}

/**
 * Merges a validated universal entity bag into an item's entities object
 * without dropping domain-specific fields. Does not mutate inputs.
 *
 * @param {object} domainEntities
 * @param {Record<string, unknown[]>|object} universalBag
 * @returns {object}
 */
export function mergeDomainAndUniversalEntities(domainEntities = {}, universalBag = {}) {
  const domain =
    domainEntities && typeof domainEntities === "object" && !Array.isArray(domainEntities)
      ? { ...domainEntities }
      : {};
  const bag = validateEntityBag(universalBag);

  // Remove any stale universal keys from domain copy, then re-apply bag.
  for (const type of ENTITY_TYPES) {
    delete domain[type];
  }

  for (const type of ENTITY_TYPES) {
    if (bag[type].length > 0) {
      domain[type] = bag[type];
    }
  }

  return domain;
}
