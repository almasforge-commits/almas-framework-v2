import {
  RELATIONSHIP_TYPES,
  isKnownRelationshipType,
  createRelationship,
} from "./relationshipContracts.js";
import { isKnownEntityType } from "../entities/entityContracts.js";
import { isKnownDomain } from "../../config/domainRegistry.js";

// Pure relationship validator. Drops invented/malformed links. No I/O.

const MAX_RELATIONSHIPS = 20;
const MAX_META_KEYS = 12;
const MAX_META_STRING = 200;

function clip(value, max = MAX_META_STRING) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeMetadata(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;

  for (const [key, value] of Object.entries(raw).slice(0, MAX_META_KEYS)) {
    if (typeof value === "string") {
      const clipped = clip(value);
      if (clipped != null) out[key] = clipped;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function isAllowedKind(value) {
  return isKnownDomain(value) || isKnownEntityType(value);
}

function fingerprint(rel) {
  return [
    rel.type,
    rel.sourceKind,
    rel.targetKind,
    rel.metadata?.sourceValue ?? "",
    rel.metadata?.targetValue ?? "",
    rel.metadata?.targetItemIndex ?? "",
  ].join("|");
}

/**
 * Validates a list of relationships. Unknown types/kinds dropped.
 * Does not mutate caller input.
 *
 * @param {unknown[]} rawList
 * @param {object} [options]
 * @returns {object[]}
 */
export function validateRelationships(rawList, options = {}) {
  const max = options.maxRelationships ?? MAX_RELATIONSHIPS;
  const list = Array.isArray(rawList) ? rawList : [];
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    if (!isKnownRelationshipType(raw.type)) continue;
    if (!isAllowedKind(raw.sourceKind) || !isAllowedKind(raw.targetKind)) continue;

    const rel = createRelationship({
      type: raw.type,
      sourceKind: raw.sourceKind,
      targetKind: raw.targetKind,
      confidence: raw.confidence,
      metadata: sanitizeMetadata(raw.metadata),
    });

    if (!rel.type || !rel.sourceKind || !rel.targetKind) continue;

    const key = fingerprint(rel);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rel);

    if (out.length >= max) break;
  }

  return out;
}

/**
 * Ensures every relationship target/source value (when present) exists in
 * the grounded entity bag or points at a real sibling item index.
 * Relationships that reference missing entities are dropped.
 *
 * @param {object[]} relationships
 * @param {object} item
 * @param {object[]} [allItems]
 * @returns {object[]}
 */
export function filterRelationshipsToExistingEntities(
  relationships,
  item,
  allItems = []
) {
  const entities =
    item?.entities && typeof item.entities === "object" ? item.entities : {};
  const list = validateRelationships(relationships);

  return list.filter((rel) => {
    const meta = rel.metadata || {};

    if (typeof meta.targetItemIndex === "number") {
      const target = allItems[meta.targetItemIndex];
      if (!target) return false;
      if (isKnownDomain(rel.targetKind)) {
        return target.kind === rel.targetKind;
      }
      return true;
    }

    if (meta.targetValue != null) {
      const bag = entities[rel.targetKind];
      if (!Array.isArray(bag)) return false;
      const needle = String(meta.targetValue).toLowerCase();
      return bag.some((v) => String(v).toLowerCase() === needle);
    }

    if (meta.sourceValue != null) {
      const bag = entities[rel.sourceKind];
      if (Array.isArray(bag)) {
        const needle = String(meta.sourceValue).toLowerCase();
        if (!bag.some((v) => String(v).toLowerCase() === needle)) return false;
      }
    }

    // Structural link with no values: only keep if both kinds are domains
    // (item-level) or target entity bag is non-empty.
    if (isKnownEntityType(rel.targetKind)) {
      const bag = entities[rel.targetKind];
      return Array.isArray(bag) && bag.length > 0;
    }

    return isKnownDomain(rel.sourceKind) && isKnownDomain(rel.targetKind);
  });
}

export { RELATIONSHIP_TYPES };
