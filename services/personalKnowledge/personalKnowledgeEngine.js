/**
 * Personal Knowledge Engine facade — classify, validate, store, retrieve.
 * DI throughout. Does not execute Finance/Tasks or call Telegram/Supabase.
 */

import { getPersonalKnowledgeConfig } from "../../config/personalKnowledge.js";
import {
  PERSONAL_SCOPE,
  WORLD_SCOPE,
  createPersonalFact,
  createRetrievalHit,
  normalizePersonalContent,
} from "./personalKnowledgeContracts.js";
import { classifyPersonalKnowledge } from "./personalKnowledgeClassifier.js";
import { validatePersonalIngest } from "./personalKnowledgeValidator.js";
import {
  createPersonalKnowledgeStore,
  defaultPersonalKnowledgeStore,
} from "./personalKnowledgeStore.js";
import {
  createWorldKnowledgeAdapter,
  defaultWorldKnowledgeAdapter,
} from "./worldKnowledgeAdapter.js";

/**
 * @param {object} [deps]
 */
export function createPersonalKnowledgeEngine(deps = {}) {
  const config = deps.config ?? getPersonalKnowledgeConfig(deps.env ?? process.env);
  const store = deps.repository ?? deps.store ?? defaultPersonalKnowledgeStore;
  const worldAdapter = deps.worldAdapter ?? defaultWorldKnowledgeAdapter;
  const classifyFn = deps.classifyFn ?? classifyPersonalKnowledge;
  const validateFn = deps.validateFn ?? validatePersonalIngest;
  const nowFn = deps.nowFn ?? (() => Date.now());

  /**
   * Ingest a grounded personal fact. Never stores world knowledge.
   * @param {object} input
   */
  async function ingest(input = {}) {
    const actorKey = String(input.actorKey ?? "").trim();
    const text = String(input.text ?? input.content ?? "").trim();
    const candidate = input.candidate ?? null;
    const sourceType = input.sourceType ?? "user_text";

    const classified = classifyFn(text, { candidate });

    // Prefer explicit extraction mapping when provided (shadow ingest).
    // Never invent: only use hints that are already validated by the caller.
    let domain = classified.domain;
    let confidence = classified.confidence;
    let scope = classified.scope;

    if (
      typeof input.domainHint === "string" &&
      input.domainHint &&
      input.domainHint !== "Timeline"
    ) {
      domain = input.domainHint;
    }
    if (Number.isFinite(input.confidenceHint)) {
      confidence = Math.min(1, Math.max(0, Number(input.confidenceHint)));
    }
    if (classified.scope === "world") {
      scope = "world";
    }

    const validation = validateFn(
      {
        actorKey,
        text,
        content: text,
        domain,
        confidence,
        scope,
        sourceType,
        candidate,
        evidence: input.evidence,
        payload: input.payload,
        financePayload: input.financePayload,
        actionType: input.actionType,
        executeFinance: input.executeFinance,
        grounded: input.grounded,
      },
      { confidenceThreshold: config.confidenceThreshold }
    );

    if (!validation.ok) {
      console.log(`[personal-knowledge] ingest rejected reason=${validation.reason}`);
      return {
        ok: false,
        reason: validation.reason,
        fact: null,
      };
    }

    const entities = Array.isArray(input.entities) ? input.entities : [];
    // Never invent entities — only pass through caller-provided ones.
    const fact = createPersonalFact({
      actorKey,
      domain,
      content: text,
      normalizedContent: normalizePersonalContent(text),
      confidence,
      evidence: input.evidence ?? {
        quote: text.slice(0, 500),
        candidateKind: candidate?.kind ?? null,
      },
      sourceType,
      entities,
      requestKey: input.requestKey ?? null,
      nowMs: nowFn(),
      status: "active",
    });

    const { fact: stored, created } = await Promise.resolve(store.upsert(fact));
    console.log(
      `[personal-knowledge] ingest ${created ? "created" : "upserted"} domain=${stored.domain}`
    );

    return {
      ok: true,
      reason: created ? "created" : "upserted",
      fact: stored,
    };
  }

  /**
   * Unified retrieval across personal (+ optional world) with provenance.
   * @param {object} input
   */
  async function retrieve(input = {}) {
    const actorKey = String(input.actorKey ?? "").trim();
    if (!actorKey) {
      return { ok: false, reason: "missing_actor_key", results: [] };
    }

    const query = String(input.query ?? "").trim();
    const limit = Number.isFinite(input.limit) ? input.limit : 20;
    const scopes = Array.isArray(input.scopes)
      ? input.scopes
      : [PERSONAL_SCOPE, WORLD_SCOPE];
    const domains = Array.isArray(input.domains) ? input.domains : null;

    /** @type {object[]} */
    const merged = [];

    if (scopes.includes(PERSONAL_SCOPE)) {
      const personalHits = await Promise.resolve(
        query
          ? store.search(actorKey, query, { limit, domains })
          : domains && domains.length === 1
            ? store.listByDomain(actorKey, domains[0], { limit })
            : store.listByActor(actorKey, { limit })
      );

      for (const fact of personalHits) {
        if (domains && !domains.includes(fact.domain)) continue;
        // Timeline filter: include dated personal facts when requesting Timeline
        if (domains?.includes("Timeline") && fact.domain === "Timeline") {
          continue; // Timeline never stored; skip
        }
        merged.push(
          createRetrievalHit({
            id: fact.id,
            actorKey: fact.actorKey,
            domain: fact.domain,
            content: fact.content,
            confidence: fact.confidence,
            scope: PERSONAL_SCOPE,
            provenance: {
              sourceType: fact.sourceType,
              evidence: fact.evidence,
              provider: "personal_store",
              retrievedAt: nowFn(),
            },
          })
        );
      }
    }

    if (scopes.includes(WORLD_SCOPE) && query) {
      const worldHits = await worldAdapter.search(query, {
        limit,
        actorKey,
      });
      for (const hit of worldHits) {
        merged.push(hit);
      }
    }

    const deduped = dedupeRetrievalHits(merged);
    return {
      ok: true,
      reason: "ok",
      results: deduped.slice(0, limit),
    };
  }

  return {
    ingest,
    retrieve,
    store,
    config,
  };
}

/**
 * Deterministic dedupe: prefer personal over world; then higher confidence; then id.
 * @param {object[]} hits
 */
export function dedupeRetrievalHits(hits) {
  const byKey = new Map();
  for (const hit of hits) {
    // Content-keyed: personal wins over world for the same normalized text.
    const key = normalizePersonalContent(hit.content);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, hit);
      continue;
    }
    const preferNew =
      (hit.scope === PERSONAL_SCOPE && existing.scope === WORLD_SCOPE) ||
      (hit.scope === existing.scope &&
        (hit.confidence ?? 0) > (existing.confidence ?? 0));
    if (preferNew) byKey.set(key, hit);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.scope !== b.scope) {
      return a.scope === PERSONAL_SCOPE ? -1 : 1;
    }
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

export const defaultPersonalKnowledgeEngine = createPersonalKnowledgeEngine();

/** Test helper */
export function createIsolatedPersonalKnowledgeEngine(overrides = {}) {
  return createPersonalKnowledgeEngine({
    store: createPersonalKnowledgeStore({
      maxEntries: overrides.maxEntries ?? 100,
    }),
    worldAdapter: createWorldKnowledgeAdapter({
      searchWorldFn: overrides.searchWorldFn,
    }),
    config: overrides.config ?? {
      enabled: true,
      confidenceThreshold: 0.7,
      maxStoreEntries: 100,
    },
    env: overrides.env ?? {},
    ...overrides,
  });
}
