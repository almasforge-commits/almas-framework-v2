/**
 * Public exports — Reasoning Engine foundation (unwired library).
 */

export {
  INSIGHT_TYPES,
  INSIGHT_STATUSES,
  RECOMMENDATION_STATUSES,
  DEFAULT_INSIGHT_CONFIDENCE_THRESHOLD,
  MIN_EVIDENCE_FACTS,
  isInsightType,
} from "./reasoningTypes.js";

export {
  normalizeInsightText,
  stableInsightHash,
  buildInsightIdempotencyKey,
  createEvidence,
  createInsight,
  createRecommendation,
} from "./reasoningContracts.js";

export {
  REASONING_RULES,
  applyReasoningRules,
  deriveRecommendationDrafts,
} from "./reasoningRules.js";

export { scoreInsightConfidence } from "./reasoningScorer.js";

export {
  REASONING_REJECT,
  validateInsightCandidate,
  validateRecommendationCandidate,
} from "./reasoningValidator.js";

export {
  createReasoningStore,
  defaultReasoningStore,
  resetReasoningStoreForTests,
} from "./reasoningStore.js";

export {
  createReasoningEngine,
  createIsolatedReasoningEngine,
  defaultReasoningEngine,
} from "./reasoningEngine.js";

export {
  runReasoningShadowObservation,
  sanitizeReasoningSummary,
  createEmptyReasoningSummary,
  createReasoningShadowDeps,
  REASONING_SKIP,
} from "./reasoningObservation.js";
