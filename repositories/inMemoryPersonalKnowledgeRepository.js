/**
 * In-memory Personal Knowledge repository — wraps existing store for tests/DI.
 */

import {
  createPersonalKnowledgeStore,
  defaultPersonalKnowledgeStore,
  resetPersonalKnowledgeStoreForTests,
} from "../services/personalKnowledge/personalKnowledgeStore.js";
import { assertPersonalKnowledgeRepository } from "./personalKnowledgeRepository.js";

/**
 * @param {object} [options]
 */
export function createInMemoryPersonalKnowledgeRepository(options = {}) {
  const repo = createPersonalKnowledgeStore(options);
  return assertPersonalKnowledgeRepository(repo);
}

export {
  defaultPersonalKnowledgeStore as defaultInMemoryPersonalKnowledgeRepository,
  resetPersonalKnowledgeStoreForTests,
};
