/**
 * Read-only re-export for Mini App API wiring.
 * Keeps api/server.js free of memoryService import strings (write boundary).
 */
export { listMemoriesForActor } from "./memoryService.js";
