/**
 * Public exports — Answer Engine (orchestration + Telegram read-only helpers).
 */

export {
  EVIDENCE_SCOPES,
  EVIDENCE_SOURCES,
  EXECUTION_NONE,
  SOURCE_TRUST,
  SCOPE_PRIORITY,
  normalizeAnswerText,
  createEvidenceItem,
  createAnswerResult,
  createRetrievalPlan,
} from "./answerContracts.js";

export { planAnswerRetrieval } from "./answerPlanner.js";

export {
  decideWorldRetrieval,
  isPersonalOnlyQuery,
  isExternalKnowledgeQuery,
} from "./worldRetrievalDecision.js";

export { retrieveAnswerEvidence } from "./answerRetriever.js";

export {
  collectConversationEvidence,
  collectPersonalEvidence,
  collectReasoningEvidence,
  collectWorldEvidence,
  collectDomainEvidence,
} from "./evidenceCollector.js";

export { rankEvidence } from "./evidenceRanker.js";

export { resolveEvidenceConflicts } from "./conflictResolver.js";

export { composeAnswer, computeConfidence } from "./answerComposer.js";

export {
  validateAnswerRequest,
  validateAnswerResult,
  ANSWER_REJECT,
} from "./answerValidator.js";

export {
  createAnswerEngine,
  createIsolatedAnswerEngine,
} from "./answerEngine.js";

export { classifyAnswerRouteIntent } from "./answerQuestionGate.js";

export { formatTelegramAnswerReply } from "./formatTelegramAnswer.js";

export {
  createTelegramAnswerEngine,
  createTelegramAnswerEngineWithWorld,
} from "./telegramAnswerFactory.js";
