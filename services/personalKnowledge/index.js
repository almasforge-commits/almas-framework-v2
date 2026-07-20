/**
 * Public exports for Personal Knowledge Engine foundation.
 * Intentionally does not import Telegram, Inbox, or domain executors.
 */

export {
  PERSONAL_KNOWLEDGE_DOMAINS,
  WRITABLE_PERSONAL_DOMAINS,
  PERSONAL_SCOPE,
  WORLD_SCOPE,
  REJECT_REASONS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  mapRegistryKindToPersonalDomain,
  isPersonalKnowledgeDomain,
  isWritablePersonalDomain,
  normalizePersonalContent,
  stableContentHash,
  buildIdempotencyKey,
  createPersonalFact,
  createRetrievalHit,
} from "./personalKnowledgeContracts.js";

export {
  classifyPersonalKnowledge,
  looksLikeWorldOrGeneralKnowledge,
} from "./personalKnowledgeClassifier.js";

export { validatePersonalIngest } from "./personalKnowledgeValidator.js";

export {
  createPersonalKnowledgeStore,
  defaultPersonalKnowledgeStore,
  resetPersonalKnowledgeStoreForTests,
} from "./personalKnowledgeStore.js";

export {
  createWorldKnowledgeAdapter,
  defaultWorldKnowledgeAdapter,
} from "./worldKnowledgeAdapter.js";

export {
  createPersonalKnowledgeEngine,
  createIsolatedPersonalKnowledgeEngine,
  defaultPersonalKnowledgeEngine,
  dedupeRetrievalHits,
} from "./personalKnowledgeEngine.js";

export {
  runPersonalKnowledgeShadowIngest,
  sanitizePersonalKnowledgeSummary,
  createEmptyPersonalKnowledgeSummary,
  entitiesFromExtractionCandidate,
  PERSONAL_INGEST_KINDS,
  createShadowIngestDeps,
} from "./personalKnowledgeObservation.js";
