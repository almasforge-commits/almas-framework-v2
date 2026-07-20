import {
  EXTRACTION_KINDS,
  FINANCE_DIRECTIONS,
  createExtractedItem,
  createEmptyTemporal,
  validateExtractionKind,
} from "./universalExtractionContracts.js";
import { ENTITY_TYPES } from "../entities/entityContracts.js";
import {
  pickUniversalEntityBag,
  mergeDomainAndUniversalEntities,
} from "../entities/entityValidator.js";
import { validateRelationships } from "../relationships/relationshipValidator.js";

// Pure validator for extracted items. Never executes domain actions.
// Never invents amounts/currencies. No I/O.

const MAX_CONTENT = 2000;

function clip(text, max = MAX_CONTENT) {
  const value = String(text ?? "");
  return value.length > max ? value.slice(0, max) : value;
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sanitizeFinanceEntities(raw = {}) {
  const out = {};
  const direction = FINANCE_DIRECTIONS.includes(raw.direction)
    ? raw.direction
    : FINANCE_DIRECTIONS.includes(raw.type)
      ? raw.type
      : null;
  if (direction) out.direction = direction;

  const amount = asFiniteNumber(raw.amount);
  if (amount != null) out.amount = amount;

  if (typeof raw.currency === "string" && raw.currency.trim()) {
    out.currency = raw.currency.trim().toUpperCase().slice(0, 8);
  }
  if (typeof raw.description === "string") {
    out.description = clip(raw.description, 500);
  }
  if (typeof raw.category === "string") {
    out.category = clip(raw.category, 120);
  }
  if (typeof raw.dateText === "string") {
    out.dateText = clip(raw.dateText, 80);
  }
  return out;
}

function sanitizeTaskEntities(raw = {}) {
  const out = {};
  if (typeof raw.title === "string") out.title = clip(raw.title, 500);
  if (typeof raw.dueDateText === "string") out.dueDateText = clip(raw.dueDateText, 80);
  if (typeof raw.project === "string") out.project = clip(raw.project, 120);
  if (typeof raw.priority === "string") out.priority = clip(raw.priority, 40);
  return out;
}

function sanitizeHealthEntities(raw = {}) {
  const out = {};
  if (typeof raw.metric === "string") out.metric = clip(raw.metric, 40);
  const value = asFiniteNumber(raw.value);
  if (value != null) out.value = value;
  if (typeof raw.unit === "string") out.unit = clip(raw.unit, 40);
  const secondary = asFiniteNumber(raw.secondaryValue);
  if (secondary != null) out.secondaryValue = secondary;
  return out;
}

function sanitizeIdeaEntities(raw = {}) {
  const out = {};
  if (typeof raw.title === "string") out.title = clip(raw.title, 200);
  if (typeof raw.summary === "string") out.summary = clip(raw.summary, 1000);
  if (Array.isArray(raw.tags)) {
    out.tags = raw.tags
      .filter((t) => typeof t === "string")
      .slice(0, 10)
      .map((t) => clip(t, 40));
  }
  if (typeof raw.relatedProject === "string") {
    out.relatedProject = clip(raw.relatedProject, 120);
  }
  return out;
}

function sanitizeProjectEntities(raw = {}) {
  const out = {};
  if (typeof raw.projectName === "string") out.projectName = clip(raw.projectName, 120);
  if (typeof raw.update === "string") out.update = clip(raw.update, 1000);
  if (typeof raw.statusHint === "string") out.statusHint = clip(raw.statusHint, 80);
  return out;
}

function sanitizeGenericEntities(raw = {}) {
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, 40)) {
    if (ENTITY_TYPES.includes(key) && Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") out[key] = clip(value, 500);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

function entitiesForKind(kind, raw) {
  if (!raw || typeof raw !== "object") return {};
  let kindSpecific;
  switch (kind) {
    case "finance":
      kindSpecific = sanitizeFinanceEntities(raw);
      break;
    case "task":
      kindSpecific = sanitizeTaskEntities(raw);
      break;
    case "health":
      kindSpecific = sanitizeHealthEntities(raw);
      break;
    case "idea":
      kindSpecific = sanitizeIdeaEntities(raw);
      break;
    case "project":
      kindSpecific = sanitizeProjectEntities(raw);
      break;
    default:
      kindSpecific = sanitizeGenericEntities(raw);
      break;
  }

  // Preserve universal named-entity bags alongside domain fields.
  const universal = pickUniversalEntityBag(raw);
  return mergeDomainAndUniversalEntities(kindSpecific, universal);
}

function clarifyFinance(entities) {
  if (entities.amount == null) {
    return { requiresClarification: true, clarificationReason: "missing_finance_amount" };
  }
  if (!entities.currency) {
    return { requiresClarification: true, clarificationReason: "missing_finance_currency" };
  }
  return { requiresClarification: false, clarificationReason: null };
}

function clarifyTask(item, entities) {
  const title =
    (typeof entities.title === "string" && entities.title.trim()) ||
    (typeof item.content === "string" && item.content.trim()) ||
    "";
  if (!title) {
    return { requiresClarification: true, clarificationReason: "missing_task_content" };
  }
  return { requiresClarification: false, clarificationReason: null };
}

function clarifyHealth(entities) {
  if (!entities.metric || entities.value == null) {
    return { requiresClarification: true, clarificationReason: "missing_health_metric" };
  }
  return { requiresClarification: false, clarificationReason: null };
}

function clarifyIdea(item, entities) {
  const text =
    (typeof item.content === "string" && item.content.trim()) ||
    (typeof entities.summary === "string" && entities.summary.trim()) ||
    (typeof entities.title === "string" && entities.title.trim()) ||
    "";
  if (!text) {
    return { requiresClarification: true, clarificationReason: "missing_idea_content" };
  }
  return { requiresClarification: false, clarificationReason: null };
}

function itemFingerprint(item) {
  return [
    item.kind,
    String(item.content ?? "").trim().toLowerCase(),
    JSON.stringify(item.entities ?? {}),
    String(item.temporal?.raw ?? ""),
  ].join("|");
}

/**
 * Validates and normalizes a list of raw extracted items.
 * Rejects unknown kinds (→ drop or unknown). Dedupes preserving order.
 * Caps to maxItems. Never mutates caller arrays/objects.
 *
 * @param {unknown[]} rawItems
 * @param {object} [options]
 * @returns {{ items: object[], truncated: boolean, needsClarification: boolean }}
 */
export function validateExtractedItems(rawItems, options = {}) {
  const maxItems = options.maxItems ?? 5;
  const list = Array.isArray(rawItems) ? rawItems : [];
  const out = [];
  const seen = new Set();
  let needsClarification = false;

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;

    const kind = validateExtractionKind(raw.kind);
    if (!kind) continue;

    const entities = entitiesForKind(kind, raw.entities);
    let content = clip(typeof raw.content === "string" ? raw.content : "");

    if (kind === "task" && !content && typeof entities.title === "string") {
      content = entities.title;
    }
    if (kind === "idea" && !content) {
      content = entities.summary || entities.title || "";
    }
    if (kind === "finance" && !content) {
      content = entities.description || "";
    }
    if (kind === "health" && !content && entities.metric != null) {
      content = [entities.metric, entities.value, entities.unit]
        .filter((v) => v != null && v !== "")
        .join(" ");
    }
    if (kind === "project" && !content) {
      content = entities.update || entities.projectName || "";
    }

    let clarification = {
      requiresClarification: Boolean(raw.requiresClarification),
      clarificationReason:
        typeof raw.clarificationReason === "string" ? raw.clarificationReason : null,
    };

    if (kind === "finance") {
      const financeClarify = clarifyFinance(entities);
      if (financeClarify.requiresClarification) clarification = financeClarify;
    } else if (kind === "task") {
      const taskClarify = clarifyTask({ content }, entities);
      if (taskClarify.requiresClarification) clarification = taskClarify;
    } else if (kind === "health") {
      const healthClarify = clarifyHealth(entities);
      if (healthClarify.requiresClarification) clarification = healthClarify;
    } else if (kind === "idea") {
      const ideaClarify = clarifyIdea({ content }, entities);
      if (ideaClarify.requiresClarification) clarification = ideaClarify;
    }

    if (clarification.requiresClarification) needsClarification = true;

    const temporal = createEmptyTemporal({
      raw:
        typeof raw.temporal?.raw === "string"
          ? raw.temporal.raw
          : typeof raw.temporalRaw === "string"
            ? raw.temporalRaw
            : entities.dueDateText || entities.dateText || null,
      resolvedDate: raw.temporal?.resolvedDate ?? null,
      timezone: raw.temporal?.timezone ?? null,
    });

    // Never invent numeric finance fields — strip amount if it was not finite.
    if (kind === "finance" && raw.entities?.amount != null && entities.amount == null) {
      clarification = {
        requiresClarification: true,
        clarificationReason: "missing_finance_amount",
      };
      needsClarification = true;
    }

    const item = createExtractedItem({
      index: out.length,
      kind,
      content,
      confidence: raw.confidence,
      entities,
      temporal,
      relationships: validateRelationships(raw.relationships),
      requiresClarification: clarification.requiresClarification,
      clarificationReason: clarification.clarificationReason,
    });

    const fingerprint = itemFingerprint(item);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(item);

    if (out.length >= maxItems) {
      return {
        items: out,
        truncated: list.length > out.length,
        needsClarification,
      };
    }
  }

  return {
    items: out,
    truncated: false,
    needsClarification,
  };
}

export { EXTRACTION_KINDS };
