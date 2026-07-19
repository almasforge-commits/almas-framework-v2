import { MemoryEngine } from "./MemoryEngine.js";
import { MemoryRepository } from "./MemoryRepository.js";

export const memory = new MemoryEngine(
  new MemoryRepository()
);