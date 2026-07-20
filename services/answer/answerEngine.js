/**
 * Answer Engine — orchestrates existing intelligence modules.
 * Architecture milestone: retrieve → rank → conflict → compose.
 * Zero execution. No LLM. No Telegram.
 */

import { getAnswerEngineConfig } from "../../config/answerEngine.js";
import { createAnswerResult, EXECUTION_NONE } from "./answerContracts.js";
import { planAnswerRetrieval } from "./answerPlanner.js";
import { retrieveAnswerEvidence } from "./answerRetriever.js";
import { rankEvidence } from "./evidenceRanker.js";
import { resolveEvidenceConflicts } from "./conflictResolver.js";
import { composeAnswer } from "./answerComposer.js";
import { dedupeEvidence } from "./evidenceDedupe.js";
import {
  validateAnswerRequest,
  validateAnswerResult,
  ANSWER_REJECT,
} from "./answerValidator.js";

/**
 * @param {object} [deps] — all collaborators injectable; no hidden globals
 */
export function createAnswerEngine(deps = {}) {
  const config =
    deps.config ?? getAnswerEngineConfig(deps.env ?? process.env);

  /**
   * Produce a structured answer object. Never executes domain writes.
   * @param {object} input
   * @param {string} input.actorKey
   * @param {string} input.query
   * @param {string|null} [input.chatId]
   * @param {object} [input.planOverrides]
   */
  async function answer(input = {}) {
    const req = validateAnswerRequest(input);
    if (!req.ok) {
      return createAnswerResult({
        answer: null,
        confidence: 0,
        needsClarification: true,
        clarificationQuestion:
          req.reason === ANSWER_REJECT.EMPTY_QUERY
            ? "Сформулируйте вопрос."
            : "Не удалось определить пользователя.",
        missingFields:
          req.reason === ANSWER_REJECT.MISSING_ACTOR
            ? ["actorKey"]
            : ["query"],
        evidenceSummary: { total: 0, byScope: {}, topIds: [], conflictCount: 0 },
      });
    }

    const actorKey = String(input.actorKey ?? input.actor?.actorKey).trim();
    const query = String(input.query ?? input.text).trim();
    const chatId = input.chatId != null ? String(input.chatId) : null;

    const plan = planAnswerRetrieval(
      { query, actorKey, chatId },
      input.planOverrides ?? {}
    );

    const { evidence, flags } = await retrieveAnswerEvidence(
      plan,
      {
        getPending: deps.getPending,
        clarificationEngine: deps.clarificationEngine,
        conversationContextStore: deps.conversationContextStore,
        retrievePersonal: deps.retrievePersonal,
        personalKnowledgeEngine: deps.personalKnowledgeEngine,
        reasoningEngine: deps.reasoningEngine,
        listInsights: deps.listInsights,
        searchWorld: deps.searchWorld,
        worldKnowledgeAdapter: deps.worldKnowledgeAdapter,
        worldKnowledgeGateway: deps.worldKnowledgeGateway,
        worldGatewayIgnoreEnabled: deps.worldGatewayIgnoreEnabled,
        worldGatewayForceEnabled: deps.worldGatewayForceEnabled,
        skipWorldCache: deps.skipWorldCache,
        getFinanceSnapshot: deps.getFinanceSnapshot,
        getTasksSnapshot: deps.getTasksSnapshot,
        searchKnowledgeFn: deps.searchKnowledgeFn,
        searchMemoryFn: deps.searchMemoryFn,
      },
      config
    );

    const { evidence: withConflicts, conflicts } =
      resolveEvidenceConflicts(evidence);

    const ranked = rankEvidence(withConflicts, {
      maxEvidence: config.maxEvidence,
      nowMs: deps.nowFn ? deps.nowFn() : Date.now(),
    });

    const uniqueRanked = dedupeEvidence(ranked);

    const composed = composeAnswer({
      rankedEvidence: uniqueRanked,
      conflicts,
      flags,
      plan,
      minConfidence: config.minAnswerConfidence,
      maxSources: config.maxSources,
    });

    const validated = validateAnswerResult(composed);
    const result = validated.result ?? composed;

    return {
      ...result,
      execution: EXECUTION_NONE,
      _debug: deps.includeDebug
        ? {
            plan,
            evidenceCount: evidence.length,
            rankedCount: ranked.length,
          }
        : undefined,
    };
  }

  return {
    answer,
    config,
    /** Exposed for tests — never writes. */
    plan: planAnswerRetrieval,
    rank: rankEvidence,
    resolveConflicts: resolveEvidenceConflicts,
    compose: composeAnswer,
  };
}

/**
 * Isolated engine for tests (no shared default deps).
 */
export function createIsolatedAnswerEngine(deps = {}) {
  return createAnswerEngine({ ...deps, env: deps.env ?? {} });
}
