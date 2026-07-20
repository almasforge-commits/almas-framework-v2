/**
 * Repository barrel — interfaces + in-memory adapters only.
 * Supabase drivers live under providers/storage (engines must not import them).
 */

export {
  PERSONAL_KNOWLEDGE_REPOSITORY_METHODS,
  isPersonalKnowledgeRepository,
  assertPersonalKnowledgeRepository,
} from "./personalKnowledgeRepository.js";

export {
  REASONING_REPOSITORY_METHODS,
  isReasoningRepository,
  assertReasoningRepository,
} from "./reasoningRepository.js";

export {
  createInMemoryPersonalKnowledgeRepository,
  defaultInMemoryPersonalKnowledgeRepository,
  resetPersonalKnowledgeStoreForTests,
} from "./inMemoryPersonalKnowledgeRepository.js";

export {
  createInMemoryReasoningRepository,
  defaultInMemoryReasoningRepository,
  resetReasoningStoreForTests,
} from "./inMemoryReasoningRepository.js";

export {
  KNOWLEDGE_REPOSITORY_METHODS,
  isKnowledgeRepository,
  assertKnowledgeRepository,
} from "./knowledgeRepository.js";

export { createInMemoryKnowledgeRepository } from "./inMemoryKnowledgeRepository.js";
