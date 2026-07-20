/**
 * Personal Knowledge shadow ingest from Inbox Universal Extraction.
 * Observation only — never executes domains, never sends Telegram.
 * Uses already-produced extraction results (no re-extraction / no LLM).
 */

import { getPersonalKnowledgeConfig } from "../../config/personalKnowledge.js";
import {
  mapRegistryKindToPersonalDomain,
  REJECT_REASONS,
} from "./personalKnowledgeContracts.js";
import { looksLikeWorldOrGeneralKnowledge } from "./personalKnowledgeClassifier.js";
import {
  createPersonalKnowledgeEngine,
  defaultPersonalKnowledgeEngine,
} from "./personalKnowledgeEngine.js";

/** Extraction kinds allowed for personal shadow ingest (closed). */
export const PERSONAL_INGEST_KINDS = Object.freeze([
  "memory",
  "goal",
  "decision",
  "contact",
  "idea",
  "health",
  "project",
  "finance",
  "task",
  "knowledge",
]);

const UNSUPPORTED_KIND = "unsupported_kind";
const REQUIRES_CLARIFICATION = "requires_clarification";
const MALFORMED_CANDIDATE = "malformed_candidate";
const MISSING_CONTENT = "missing_content";
const INGEST_FAILED = "ingest_failed";

/**
 * @returns {object}
 */
export function createEmptyPersonalKnowledgeSummary() {
  return {
    personalKnowledge: {
      attempted: 0,
      accepted: 0,
      rejected: 0,
      acceptedDomains: [],
      rejectedReasons: {},
      shadow: true,
    },
  };
}

/**
 * Sanitize summary for Inbox metadata (counts + reason codes only).
 * @param {object} summary
 */
export function sanitizePersonalKnowledgeSummary(summary) {
  const pk = summary?.personalKnowledge ?? summary ?? {};
  const rejectedReasons = {};
  if (pk.rejectedReasons && typeof pk.rejectedReasons === "object") {
    for (const [code, count] of Object.entries(pk.rejectedReasons)) {
      const key = String(code).slice(0, 64);
      const n = Number(count);
      if (key && Number.isFinite(n) && n > 0) {
        rejectedReasons[key] = Math.floor(n);
      }
    }
  }

  const acceptedDomains = Array.isArray(pk.acceptedDomains)
    ? [...new Set(pk.acceptedDomains.map(String).filter(Boolean))].slice(0, 32)
    : [];

  return {
    personalKnowledge: {
      attempted: Math.max(0, Math.floor(Number(pk.attempted) || 0)),
      accepted: Math.max(0, Math.floor(Number(pk.accepted) || 0)),
      rejected: Math.max(0, Math.floor(Number(pk.rejected) || 0)),
      acceptedDomains,
      rejectedReasons,
      shadow: true,
    },
  };
}

/**
 * Flatten extraction entity bags into {type,value}[] without inventing values.
 * @param {unknown} entities
 */
export function entitiesFromExtractionCandidate(entities) {
  if (!entities || typeof entities !== "object") return [];
  if (Array.isArray(entities)) {
    return entities
      .map((e) => {
        if (typeof e === "string" && e.trim()) {
          return { type: "unknown", value: e.trim().slice(0, 200) };
        }
        if (e && typeof e === "object") {
          const value = String(e.value ?? e.name ?? "").trim();
          if (!value) return null;
          return {
            type: String(e.type ?? "unknown").slice(0, 64),
            value: value.slice(0, 200),
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  const out = [];
  for (const [type, values] of Object.entries(entities)) {
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      if (typeof v === "string" && v.trim()) {
        out.push({ type: String(type).slice(0, 64), value: v.trim().slice(0, 200) });
      } else if (v && typeof v === "object") {
        const value = String(v.value ?? v.name ?? "").trim();
        if (value) {
          out.push({
            type: String(type).slice(0, 64),
            value: value.slice(0, 200),
          });
        }
      }
    }
  }
  return out;
}

/**
 * Run shadow ingest over extraction items. Never throws.
 *
 * @param {object} input
 * @param {object} [deps]
 * @returns {Promise<{ skipped: boolean, summary: object, results: object[] }>}
 */
export async function runPersonalKnowledgeShadowIngest(input = {}, deps = {}) {
  const empty = {
    skipped: true,
    summary: createEmptyPersonalKnowledgeSummary(),
    results: [],
  };

  try {
    const config =
      deps.personalKnowledgeConfig ??
      getPersonalKnowledgeConfig(deps.env ?? process.env);
    const enabled =
      deps.forcePersonalKnowledgeEnabled === true || config.enabled === true;

    if (!enabled) {
      return empty;
    }

    const requestKey =
      typeof input.requestKey === "string" && input.requestKey.trim()
        ? input.requestKey.trim()
        : null;
    const actorKey = String(input.actor?.actorKey ?? input.actorKey ?? "").trim();
    const extraction = input.extraction;
    const items = Array.isArray(extraction?.items) ? extraction.items : [];

    const attempted = items.length;
    const summary = createEmptyPersonalKnowledgeSummary().personalKnowledge;
    summary.attempted = attempted;
    const results = [];

    if (!actorKey) {
      for (let i = 0; i < items.length; i += 1) {
        bumpReason(summary.rejectedReasons, REJECT_REASONS.MISSING_ACTOR);
        summary.rejected += 1;
        results.push({
          index: items[i]?.index ?? i,
          ok: false,
          reason: REJECT_REASONS.MISSING_ACTOR,
        });
      }
      return {
        skipped: false,
        summary: sanitizePersonalKnowledgeSummary({ personalKnowledge: summary }),
        results,
      };
    }

    const engine =
      deps.personalKnowledgeEngine ??
      defaultPersonalKnowledgeEngine;
    const threshold = Number.isFinite(config.confidenceThreshold)
      ? config.confidenceThreshold
      : 0.7;

    const sourceType =
      input.sourceType === "telegram_voice" ? "user_voice" : "extraction_candidate";

    // Preserve extraction order (by index, then array order).
    const ordered = items
      .map((item, arrayIndex) => ({ item, arrayIndex }))
      .sort((a, b) => {
        const ia = Number.isInteger(a.item?.index) ? a.item.index : a.arrayIndex;
        const ib = Number.isInteger(b.item?.index) ? b.item.index : b.arrayIndex;
        return ia - ib;
      });

    for (const { item, arrayIndex } of ordered) {
      const index = Number.isInteger(item?.index) ? item.index : arrayIndex;
      const outcome = await ingestOneCandidate({
        item,
        index,
        actorKey,
        requestKey,
        sourceType,
        inboxSourceType: input.sourceType ?? null,
        threshold,
        engine,
      });
      results.push(outcome);
      if (outcome.ok) {
        summary.accepted += 1;
        if (outcome.domain) summary.acceptedDomains.push(outcome.domain);
      } else {
        summary.rejected += 1;
        bumpReason(summary.rejectedReasons, outcome.reason || INGEST_FAILED);
      }
    }

    summary.acceptedDomains = [...new Set(summary.acceptedDomains)];

    return {
      skipped: false,
      summary: sanitizePersonalKnowledgeSummary({ personalKnowledge: summary }),
      results,
    };
  } catch {
    console.log("[personal-knowledge] shadow ingest failed");
    return {
      skipped: false,
      summary: sanitizePersonalKnowledgeSummary({
        personalKnowledge: {
          attempted: 0,
          accepted: 0,
          rejected: 0,
          acceptedDomains: [],
          rejectedReasons: { [INGEST_FAILED]: 1 },
          shadow: true,
        },
      }),
      results: [],
    };
  }
}

/**
 * @param {object} args
 */
async function ingestOneCandidate({
  item,
  index,
  actorKey,
  requestKey,
  sourceType,
  inboxSourceType,
  threshold,
  engine,
}) {
  if (!item || typeof item !== "object") {
    return { index, ok: false, reason: MALFORMED_CANDIDATE };
  }

  const kind = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "";
  if (!PERSONAL_INGEST_KINDS.includes(kind)) {
    return { index, ok: false, reason: UNSUPPORTED_KIND };
  }

  if (item.requiresClarification === true) {
    return { index, ok: false, reason: REQUIRES_CLARIFICATION };
  }

  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!content) {
    return { index, ok: false, reason: MISSING_CONTENT };
  }

  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < threshold) {
    return { index, ok: false, reason: REJECT_REASONS.LOW_CONFIDENCE };
  }

  if (looksLikeWorldOrGeneralKnowledge(content)) {
    return { index, ok: false, reason: REJECT_REASONS.WORLD_OR_GENERAL };
  }

  const domain = mapRegistryKindToPersonalDomain(kind);
  if (!domain || domain === "Timeline") {
    return { index, ok: false, reason: UNSUPPORTED_KIND };
  }

  const idempotencyRequestKey = requestKey
    ? `${requestKey}:pk:${index}`
    : null;

  const evidence = {
    quote: content.slice(0, 500),
    candidateKind: kind,
    inboxRequestKey: requestKey,
    extractionItemIndex: index,
    sourceType: inboxSourceType ?? null,
  };

  try {
    const result = await engine.ingest({
      actorKey,
      text: content,
      content,
      sourceType,
      candidate: { kind, confidence },
      domainHint: domain,
      confidenceHint: confidence,
      entities: entitiesFromExtractionCandidate(item.entities),
      evidence,
      requestKey: idempotencyRequestKey,
      grounded: true,
    });

    if (!result?.ok) {
      return {
        index,
        ok: false,
        reason: result?.reason || INGEST_FAILED,
        domain,
      };
    }

    return {
      index,
      ok: true,
      reason: result.reason,
      domain: result.fact?.domain ?? domain,
      factId: result.fact?.id ?? null,
    };
  } catch {
    return { index, ok: false, reason: INGEST_FAILED, domain };
  }
}

function bumpReason(bag, reason) {
  const key = String(reason || INGEST_FAILED).slice(0, 64);
  bag[key] = (bag[key] || 0) + 1;
}

/** Test helper */
export function createShadowIngestDeps(overrides = {}) {
  return {
    forcePersonalKnowledgeEnabled: true,
    personalKnowledgeConfig: {
      enabled: true,
      confidenceThreshold: 0.7,
      maxStoreEntries: 200,
      shadowIngest: true,
    },
    personalKnowledgeEngine:
      overrides.engine ||
      createPersonalKnowledgeEngine({
        config: {
          enabled: true,
          confidenceThreshold: 0.7,
          maxStoreEntries: 200,
        },
        store: overrides.store,
        env: {},
      }),
    ...overrides,
  };
}
