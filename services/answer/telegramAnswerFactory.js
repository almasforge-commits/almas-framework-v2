/**
 * Injectable Answer Engine factory for Telegram read-only path.
 * Shares in-memory PK/reasoning stores used by shadow ingest when defaults used.
 * All deps overridable — no hidden required globals for tests.
 *
 * World Knowledge (D-028): optional gateway via DI or async composition helper.
 * Default-off — no gateway unless overrides / env wiring enable it.
 */

import { getAnswerEngineConfig } from "../../config/answerEngine.js";
import { createAnswerEngine } from "./answerEngine.js";
import { defaultClarificationEngine } from "../context/clarificationEngine.js";
import { defaultPersonalKnowledgeEngine } from "../personalKnowledge/personalKnowledgeEngine.js";
import { defaultReasoningEngine } from "../reasoning/reasoningEngine.js";
import { defaultWorldKnowledgeAdapter } from "../personalKnowledge/worldKnowledgeAdapter.js";
import { getBalance } from "../finance/financeService.js";
import { getActiveTasks } from "../storage/taskService.js";
import { searchKnowledge } from "../search/knowledgeSearchService.js";
import { searchMemories } from "../storage/memoryService.js";
import { searchIdeas } from "../ideas/ideaService.js";
import { createWorldKnowledgeForTelegram } from "../worldKnowledge/worldKnowledgeFactory.js";

/**
 * Sync factory — accepts an already-built gateway (or null).
 * Does not construct hidden singletons.
 *
 * @param {object} [overrides]
 */
export function createTelegramAnswerEngine(overrides = {}) {
  const baseConfig = getAnswerEngineConfig(overrides.env ?? process.env);
  const config = {
    ...baseConfig,
    // Telegram read-only path is active without requiring .env edits.
    enabled: true,
    allowExecution: false,
    ...(overrides.config || {}),
  };

  const worldKnowledgeGateway =
    overrides.worldKnowledgeGateway !== undefined
      ? overrides.worldKnowledgeGateway
      : overrides.worldKnowledge?.gateway ?? null;

  return createAnswerEngine({
    config,
    env: overrides.env ?? {},
    clarificationEngine:
      overrides.clarificationEngine ?? defaultClarificationEngine,
    personalKnowledgeEngine:
      overrides.personalKnowledgeEngine ?? defaultPersonalKnowledgeEngine,
    reasoningEngine: overrides.reasoningEngine ?? defaultReasoningEngine,
    worldKnowledgeAdapter:
      overrides.worldKnowledgeAdapter ?? defaultWorldKnowledgeAdapter,
    worldKnowledgeGateway,
    // Factory already applies effectiveMode; do not double-block on gateway config.enabled.
    worldGatewayIgnoreEnabled:
      overrides.worldGatewayIgnoreEnabled ??
      (worldKnowledgeGateway != null ? true : false),
    getPending: overrides.getPending,
    retrievePersonal: overrides.retrievePersonal,
    searchWorld: overrides.searchWorld,
    listInsights: overrides.listInsights,
    getFinanceSnapshot:
      overrides.getFinanceSnapshot ??
      (async ({ actorKey } = {}) => {
        const userId = String(actorKey || "")
          .replace(/^telegram:/, "")
          .trim();
        return getBalance(userId || "default");
      }),
    getTasksSnapshot:
      overrides.getTasksSnapshot ?? (async () => getActiveTasks()),
    searchKnowledgeFn: overrides.searchKnowledgeFn ?? searchKnowledge,
    searchMemoryFn:
      overrides.searchMemoryFn ??
      (async (query, { actorKey } = {}) =>
        searchMemories(query, { actorKey })),
    searchIdeasFn:
      overrides.searchIdeasFn ??
      (async (query, { actorKey } = {}) =>
        searchIdeas(query, { actorKey })),
    includeDebug: overrides.includeDebug === true,
    nowFn: overrides.nowFn,
  });
}

/**
 * Async composition: resolve World Knowledge (off/shadow/active) then build Answer Engine.
 * Default env keeps mode off → gateway null → identical to pre-D-028 Telegram behavior.
 *
 * @param {object} [overrides]
 */
export async function createTelegramAnswerEngineWithWorld(overrides = {}) {
  let worldBundle = overrides.worldKnowledge ?? null;
  let gateway = overrides.worldKnowledgeGateway;

  if (gateway === undefined && !worldBundle) {
    const createWk =
      overrides.createWorldKnowledgeFn ?? createWorldKnowledgeForTelegram;
    worldBundle = await createWk({
      env: overrides.env ?? process.env,
      providers: overrides.worldProviders,
      allowMockProviders: overrides.allowMockProviders === true,
      providerManager: overrides.worldProviderManager,
      cache: overrides.worldCache,
      onAudit: overrides.onWorldAudit,
      logger: overrides.worldLogger,
      nowFn: overrides.nowFn,
      config: overrides.worldKnowledgeConfig,
    });
    gateway = worldBundle.gateway;
  } else if (gateway === undefined && worldBundle) {
    gateway = worldBundle.gateway ?? null;
  }

  const engine = createTelegramAnswerEngine({
    ...overrides,
    worldKnowledgeGateway: gateway ?? null,
    worldKnowledge: worldBundle,
  });

  return {
    engine,
    worldKnowledge: worldBundle ?? {
      gateway: gateway ?? null,
      mode: gateway ? "active" : "off",
    },
  };
}
