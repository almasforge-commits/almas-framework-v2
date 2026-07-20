/**
 * Reasoning shadow observation — audit-only bridge from Personal Knowledge.
 * Does not import Inbox. Does not send Telegram. No LLM.
 */

import { getReasoningConfig } from "../../config/reasoning.js";
import { getPersonalKnowledgeConfig } from "../../config/personalKnowledge.js";
import {
  createReasoningEngine,
  defaultReasoningEngine,
} from "./reasoningEngine.js";
import { defaultPersonalKnowledgeEngine } from "../personalKnowledge/personalKnowledgeEngine.js";

export const REASONING_SKIP = Object.freeze({
  REASONING_DISABLED: "reasoning_disabled",
  PK_DISABLED: "personal_knowledge_disabled",
  NO_PERSONAL_FACTS: "no_personal_facts",
  MISSING_ACTOR: "missing_actor_key",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  REASONING_FAILED: "reasoning_failed",
});

/**
 * @returns {object}
 */
export function createEmptyReasoningSummary(overrides = {}) {
  return {
    reasoning: {
      attempted: false,
      factsConsidered: 0,
      insightsDerived: 0,
      recommendationsDerived: 0,
      insightTypes: [],
      rejectedReasons: {},
      shadow: true,
      ...overrides,
    },
  };
}

/**
 * Sanitize reasoning audit for Inbox metadata.
 * Counts + type names + reason codes only.
 * @param {object} summary
 */
export function sanitizeReasoningSummary(summary) {
  const r = summary?.reasoning ?? summary ?? {};
  const rejectedReasons = {};
  if (r.rejectedReasons && typeof r.rejectedReasons === "object") {
    for (const [code, count] of Object.entries(r.rejectedReasons)) {
      const key = String(code).slice(0, 64);
      const n = Number(count);
      if (key && Number.isFinite(n) && n > 0) {
        rejectedReasons[key] = Math.floor(n);
      }
    }
  }

  const insightTypes = Array.isArray(r.insightTypes)
    ? [...new Set(r.insightTypes.map(String).filter(Boolean))].slice(0, 32)
    : [];

  return {
    reasoning: {
      attempted: Boolean(r.attempted),
      factsConsidered: Math.max(0, Math.floor(Number(r.factsConsidered) || 0)),
      insightsDerived: Math.max(0, Math.floor(Number(r.insightsDerived) || 0)),
      recommendationsDerived: Math.max(
        0,
        Math.floor(Number(r.recommendationsDerived) || 0)
      ),
      insightTypes,
      rejectedReasons,
      shadow: true,
    },
  };
}

/**
 * Run shadow reasoning from accepted Personal Knowledge facts.
 * Never throws.
 *
 * @param {object} input
 * @param {object} [deps]
 * @returns {Promise<{ skipped: boolean, reason?: string, summary: object }>}
 */
export async function runReasoningShadowObservation(input = {}, deps = {}) {
  try {
    const reasoningConfig =
      deps.reasoningConfig ?? getReasoningConfig(deps.env ?? process.env);
    const pkConfig =
      deps.personalKnowledgeConfig ??
      getPersonalKnowledgeConfig(deps.env ?? process.env);

    const reasoningEnabled =
      deps.forceReasoningEnabled === true ||
      (reasoningConfig.enabled === true && reasoningConfig.mode === "shadow");
    const pkEnabled =
      deps.forcePersonalKnowledgeEnabled === true || pkConfig.enabled === true;

    if (!reasoningEnabled) {
      return {
        skipped: true,
        reason: REASONING_SKIP.REASONING_DISABLED,
        summary: null,
      };
    }

    if (!pkEnabled) {
      return {
        skipped: true,
        reason: REASONING_SKIP.PK_DISABLED,
        summary: null,
      };
    }

    const actorKey = String(input.actor?.actorKey ?? input.actorKey ?? "").trim();
    const requestKey =
      typeof input.requestKey === "string" && input.requestKey.trim()
        ? input.requestKey.trim()
        : null;

    if (!actorKey) {
      return {
        skipped: false,
        reason: REASONING_SKIP.MISSING_ACTOR,
        summary: sanitizeReasoningSummary(
          createEmptyReasoningSummary({
            attempted: false,
            rejectedReasons: { [REASONING_SKIP.MISSING_ACTOR]: 1 },
          })
        ),
      };
    }

    // Skip when this turn accepted no Personal Knowledge facts.
    const acceptedThisTurn = Number(
      input.personalKnowledgeSummary?.personalKnowledge?.accepted ??
        input.acceptedCount
    );
    if (Number.isFinite(acceptedThisTurn) && acceptedThisTurn <= 0) {
      return {
        skipped: false,
        reason: REASONING_SKIP.NO_PERSONAL_FACTS,
        summary: sanitizeReasoningSummary(
          createEmptyReasoningSummary({
            attempted: false,
            factsConsidered: 0,
            rejectedReasons: { [REASONING_SKIP.NO_PERSONAL_FACTS]: 1 },
          })
        ),
      };
    }

    // Prefer facts accepted in this turn when provided; else load from PK store.
    let facts = Array.isArray(input.acceptedFacts)
      ? input.acceptedFacts.filter(
          (f) => f && f.actorKey === actorKey && f.scope !== "world"
        )
      : null;

    if (!facts) {
      const pkEngine =
        deps.personalKnowledgeEngine ?? defaultPersonalKnowledgeEngine;
      const store = pkEngine.store;
      if (!store || typeof store.listByActor !== "function") {
        facts = [];
      } else {
        const limit = reasoningConfig.maxFacts ?? 100;
        const listed = await Promise.resolve(
          store.listByActor(actorKey, { limit })
        );
        facts = (listed || []).filter(
          (f) => f && f.scope !== "world" && f.status === "active"
        );
      }
    }

    if (!facts || facts.length === 0) {
      return {
        skipped: false,
        reason: REASONING_SKIP.NO_PERSONAL_FACTS,
        summary: sanitizeReasoningSummary(
          createEmptyReasoningSummary({
            attempted: false,
            factsConsidered: 0,
            rejectedReasons: { [REASONING_SKIP.NO_PERSONAL_FACTS]: 1 },
          })
        ),
      };
    }

    const engine = deps.reasoningEngine ?? defaultReasoningEngine;
    const maxFacts = reasoningConfig.maxFacts ?? 100;
    const boundedFacts = facts.slice(0, maxFacts);

    const insightsResult = await engine.deriveInsights({
      actorKey,
      facts: boundedFacts,
      requestKey: requestKey ? `${requestKey}:reasoning` : null,
    });

    const insights = Array.isArray(insightsResult?.insights)
      ? insightsResult.insights.slice(0, reasoningConfig.maxInsights ?? 50)
      : [];

    const recsResult = await engine.deriveRecommendations({
      actorKey,
      insights,
      requestKey: requestKey ? `${requestKey}:reasoning` : null,
    });

    const recommendations = Array.isArray(recsResult?.recommendations)
      ? recsResult.recommendations.slice(
          0,
          reasoningConfig.maxRecommendations ?? 50
        )
      : [];

    const rejectedReasons = {};
    for (const r of insightsResult?.rejected || []) {
      const code = String(r.reason || REASONING_SKIP.INSUFFICIENT_EVIDENCE).slice(
        0,
        64
      );
      rejectedReasons[code] = (rejectedReasons[code] || 0) + 1;
    }

    const insightTypes = [
      ...new Set(insights.map((i) => i.type).filter(Boolean)),
    ];

    // Stable counts: list from store after upsert so repeats don't inflate.
    const listedInsights = await Promise.resolve(
      engine.listInsights(actorKey, {
        limit: reasoningConfig.maxInsights ?? 50,
      })
    );
    const listedRecs = await Promise.resolve(
      engine.listRecommendations(actorKey, {
        limit: reasoningConfig.maxRecommendations ?? 50,
      })
    );

    // For this request's audit: report derived this pass uniquely by type,
    // but use store sizes only for the types touched this turn when possible.
    const thisPassInsightIds = new Set(insights.map((i) => i.id));
    const insightsDerived = listedInsights.filter((i) =>
      thisPassInsightIds.has(i.id)
    ).length;
    const thisPassRecIds = new Set(recommendations.map((r) => r.id));
    const recommendationsDerived = listedRecs.filter((r) =>
      thisPassRecIds.has(r.id)
    ).length;

    console.log(
      `[reasoning] shadow observation facts=${boundedFacts.length} insights=${insightsDerived} recs=${recommendationsDerived}`
    );

    return {
      skipped: false,
      reason: "ok",
      summary: sanitizeReasoningSummary({
        reasoning: {
          attempted: true,
          factsConsidered: boundedFacts.length,
          insightsDerived,
          recommendationsDerived,
          insightTypes,
          rejectedReasons,
          shadow: true,
        },
      }),
    };
  } catch {
    console.log("[reasoning] shadow observation failed");
    return {
      skipped: false,
      reason: REASONING_SKIP.REASONING_FAILED,
      summary: sanitizeReasoningSummary(
        createEmptyReasoningSummary({
          attempted: true,
          rejectedReasons: { [REASONING_SKIP.REASONING_FAILED]: 1 },
        })
      ),
    };
  }
}

/** Test helper */
export function createReasoningShadowDeps(overrides = {}) {
  const reasoningEngine =
    overrides.reasoningEngine ||
    createReasoningEngine({
      store: overrides.reasoningStore,
      confidenceThreshold: overrides.confidenceThreshold,
    });
  return {
    forceReasoningEnabled: true,
    forcePersonalKnowledgeEnabled: true,
    reasoningConfig: {
      enabled: true,
      mode: "shadow",
      maxFacts: 100,
      maxInsights: 50,
      maxRecommendations: 50,
      shadow: true,
    },
    personalKnowledgeConfig: {
      enabled: true,
      confidenceThreshold: 0.7,
      shadowIngest: true,
    },
    reasoningEngine,
    personalKnowledgeEngine: overrides.personalKnowledgeEngine,
    ...overrides,
  };
}
