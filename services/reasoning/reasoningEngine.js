/**
 * Reasoning Engine facade — derive evidence-backed insights & recommendations.
 * DI throughout. No Telegram, database, or LLM imports.
 */

import {
  createInsight,
  createRecommendation,
  normalizeInsightText,
} from "./reasoningContracts.js";
import {
  applyReasoningRules,
  deriveRecommendationDrafts,
} from "./reasoningRules.js";
import { scoreInsightConfidence } from "./reasoningScorer.js";
import {
  validateInsightCandidate,
  validateRecommendationCandidate,
} from "./reasoningValidator.js";
import {
  createReasoningStore,
  defaultReasoningStore,
} from "./reasoningStore.js";
import { DEFAULT_INSIGHT_CONFIDENCE_THRESHOLD } from "./reasoningTypes.js";

/**
 * @param {object} [deps]
 */
export function createReasoningEngine(deps = {}) {
  const store = deps.repository ?? deps.store ?? defaultReasoningStore;
  const listFactsFn =
    typeof deps.listFactsFn === "function" ? deps.listFactsFn : async () => [];
  const applyRulesFn = deps.applyRulesFn ?? applyReasoningRules;
  const scoreFn = deps.scoreFn ?? scoreInsightConfidence;
  const validateInsightFn = deps.validateInsightFn ?? validateInsightCandidate;
  const validateRecFn =
    deps.validateRecommendationFn ?? validateRecommendationCandidate;
  const recommendDraftsFn =
    deps.recommendDraftsFn ?? deriveRecommendationDrafts;
  const nowFn = deps.nowFn ?? (() => Date.now());
  const confidenceThreshold = Number.isFinite(deps.confidenceThreshold)
    ? deps.confidenceThreshold
    : DEFAULT_INSIGHT_CONFIDENCE_THRESHOLD;

  /**
   * Derive insights from personal facts for one actor.
   * @param {object} input
   */
  async function deriveInsights(input = {}) {
    const actorKey = String(input.actorKey ?? "").trim();
    if (!actorKey) {
      return { ok: false, reason: "missing_actor_key", insights: [], rejected: [] };
    }

    let facts = Array.isArray(input.facts) ? input.facts : null;
    if (!facts) {
      try {
        facts = await listFactsFn(actorKey, input.listFactsOpts || {});
      } catch {
        console.log("[reasoning] listFacts failed");
        facts = [];
      }
    }

    const personalFacts = (facts || []).filter(
      (f) => f && f.actorKey === actorKey && f.scope !== "world"
    );

    const candidates = applyRulesFn(personalFacts);
    const accepted = [];
    const rejected = [];

    for (const candidate of candidates) {
      const supportingFacts = personalFacts.filter((f) =>
        candidate.factIds.includes(f.id)
      );
      const contradictingFacts = personalFacts.filter((f) =>
        (candidate.contradictionFactIds || []).includes(f.id)
      );

      const scored = scoreFn({
        supportingFacts,
        contradictingFacts,
        nowMs: nowFn(),
      });

      const validation = validateInsightFn(
        {
          actorKey,
          type: candidate.type,
          title: candidate.title,
          confidence: scored.confidence,
          evidence: scored.evidence,
          supportingFacts,
          contradictingFacts,
        },
        { confidenceThreshold }
      );

      if (!validation.ok) {
        rejected.push({
          ruleId: candidate.ruleId,
          type: candidate.type,
          reason: validation.reason,
        });
        continue;
      }

      const insight = createInsight({
        actorKey,
        type: candidate.type,
        title: candidate.title,
        description: candidate.description,
        confidence: scored.confidence,
        evidence: scored.evidence.filter((e) => e.reason === "supporting_fact"),
        relatedFacts: supportingFacts.map((f) => f.id),
        relatedEntities: candidate.relatedEntities || [],
        relatedDomains: candidate.relatedDomains || [],
        requestKey: input.requestKey
          ? `${input.requestKey}:insight:${candidate.ruleId}`
          : null,
        nowMs: nowFn(),
        status: "active",
      });

      const { insight: stored, created } = await Promise.resolve(
        store.upsertInsight(insight)
      );
      accepted.push({ ...stored, created });
    }

    console.log(
      `[reasoning] deriveInsights actor_ok accepted=${accepted.length} rejected=${rejected.length}`
    );

    return { ok: true, reason: "ok", insights: accepted, rejected };
  }

  /**
   * Derive recommendations only from stored/active insights.
   * @param {object} input
   */
  async function deriveRecommendations(input = {}) {
    const actorKey = String(input.actorKey ?? "").trim();
    if (!actorKey) {
      return {
        ok: false,
        reason: "missing_actor_key",
        recommendations: [],
        rejected: [],
      };
    }

    const insights =
      Array.isArray(input.insights) && input.insights.length
        ? input.insights
        : await Promise.resolve(store.listInsights(actorKey, { limit: 100 }));

    const drafts = recommendDraftsFn(insights);
    const accepted = [];
    const rejected = [];

    for (const draft of drafts) {
      const validation = validateRecFn({
        actorKey,
        title: draft.title,
        insightIds: draft.insightIds,
      });
      if (!validation.ok) {
        rejected.push({ title: draft.title, reason: validation.reason });
        continue;
      }

      const rec = createRecommendation({
        actorKey,
        title: draft.title,
        description: draft.description,
        insightIds: draft.insightIds,
        confidence: draft.confidence,
        requestKey: input.requestKey
          ? `${input.requestKey}:rec:${normalizeInsightText(draft.title).slice(0, 24)}`
          : null,
        nowMs: nowFn(),
      });

      const { recommendation: stored, created } = await Promise.resolve(
        store.upsertRecommendation(rec)
      );
      accepted.push({ ...stored, created });
    }

    return { ok: true, reason: "ok", recommendations: accepted, rejected };
  }

  async function listInsights(actorKey, opts = {}) {
    return Promise.resolve(store.listInsights(actorKey, opts));
  }

  async function searchInsights(actorKey, query, opts = {}) {
    return Promise.resolve(store.searchInsights(actorKey, query, opts));
  }

  async function listRecommendations(actorKey, opts = {}) {
    return Promise.resolve(store.listRecommendations(actorKey, opts));
  }

  async function searchRecommendations(actorKey, query, opts = {}) {
    return Promise.resolve(store.searchRecommendations(actorKey, query, opts));
  }

  async function deleteInsight(actorKey, id) {
    return Promise.resolve(store.deleteInsight(actorKey, id));
  }

  /**
   * Clear then re-derive insights (+ optional recommendations).
   */
  async function recalculate(input = {}) {
    const actorKey = String(input.actorKey ?? "").trim();
    if (!actorKey) {
      return { ok: false, reason: "missing_actor_key" };
    }
    await Promise.resolve(store.clear(actorKey));
    const insightsResult = await deriveInsights(input);
    const recsResult =
      input.skipRecommendations === true
        ? { recommendations: [] }
        : await deriveRecommendations({
            actorKey,
            insights: insightsResult.insights,
            requestKey: input.requestKey,
          });
    return {
      ok: true,
      insights: insightsResult.insights,
      rejected: insightsResult.rejected,
      recommendations: recsResult.recommendations || [],
    };
  }

  async function clear(actorKey) {
    return Promise.resolve(store.clear(actorKey));
  }

  return {
    deriveInsights,
    deriveRecommendations,
    listInsights,
    searchInsights,
    listRecommendations,
    searchRecommendations,
    deleteInsight,
    recalculate,
    clear,
    store,
  };
}

export const defaultReasoningEngine = createReasoningEngine();

/** Test helper with isolated store */
export function createIsolatedReasoningEngine(overrides = {}) {
  return createReasoningEngine({
    store: createReasoningStore({ maxEntries: overrides.maxEntries ?? 200 }),
    confidenceThreshold: overrides.confidenceThreshold,
    listFactsFn: overrides.listFactsFn,
    ...overrides,
  });
}
