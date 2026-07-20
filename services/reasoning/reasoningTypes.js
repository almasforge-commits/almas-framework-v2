/**
 * Reasoning insight type vocabulary (closed set).
 * Pure constants — no I/O.
 */

export const INSIGHT_TYPES = Object.freeze([
  "ProductivityPattern",
  "FinancialPattern",
  "HabitPattern",
  "SleepPattern",
  "HealthPattern",
  "LearningPattern",
  "IdeaPattern",
  "WorkPattern",
  "DecisionPattern",
  "PreferencePattern",
  "RelationshipPattern",
  "ProjectPattern",
  "GoalPattern",
  "RiskPattern",
  "OpportunityPattern",
]);

export const INSIGHT_STATUSES = Object.freeze([
  "active",
  "rejected",
  "superseded",
]);

export const RECOMMENDATION_STATUSES = Object.freeze([
  "active",
  "dismissed",
  "superseded",
]);

export const DEFAULT_INSIGHT_CONFIDENCE_THRESHOLD = 0.55;
export const MIN_EVIDENCE_FACTS = 2;

/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function isInsightType(type) {
  return INSIGHT_TYPES.includes(type);
}
