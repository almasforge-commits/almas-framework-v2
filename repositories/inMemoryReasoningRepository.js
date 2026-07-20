/**
 * In-memory Reasoning repository — wraps existing store for tests/DI.
 */

import {
  createReasoningStore,
  defaultReasoningStore,
  resetReasoningStoreForTests,
} from "../services/reasoning/reasoningStore.js";
import { assertReasoningRepository } from "./reasoningRepository.js";

/**
 * @param {object} [options]
 */
export function createInMemoryReasoningRepository(options = {}) {
  const repo = createReasoningStore(options);
  return assertReasoningRepository(repo);
}

export {
  defaultReasoningStore as defaultInMemoryReasoningRepository,
  resetReasoningStoreForTests,
};
