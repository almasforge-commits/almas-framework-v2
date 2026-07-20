/**
 * Answer planner — deterministic intent + which services participate.
 * Does not call LLM. Does not execute domains.
 */

import { createRetrievalPlan } from "./answerContracts.js";
import { decideWorldRetrieval } from "./worldRetrievalDecision.js";

const FINANCE_HINT =
  /баланс|расход|доход|статистик|истори|потрат|finance|balance|expense|income/i;
const TASK_HINT = /задач|task|todo|напомни|купить|сделать/i;
const KNOWLEDGE_HINT = /знани|knowledge|найди|найти|открой|покажи/i;
const MEMORY_HINT = /вспомни|памят|memory/i;

/**
 * Build a retrieval plan from the user question.
 * @param {object} input
 * @param {string} input.query
 * @param {string} input.actorKey
 * @param {string|null} [input.chatId]
 * @param {object} [overrides]
 */
export function planAnswerRetrieval(input = {}, overrides = {}) {
  const query = String(input.query ?? "").trim();
  const actorKey = String(input.actorKey ?? "").trim();

  const domains = [];
  let intent = "general";

  if (FINANCE_HINT.test(query)) {
    intent = "finance_query";
    domains.push("finance");
  }
  if (TASK_HINT.test(query)) {
    if (intent === "general") intent = "task_query";
    domains.push("tasks");
  }
  if (KNOWLEDGE_HINT.test(query)) {
    if (intent === "general") intent = "knowledge_query";
    domains.push("knowledge");
  }
  if (MEMORY_HINT.test(query)) {
    if (intent === "general") intent = "memory_query";
    domains.push("memory");
  }

  const worldDecision = decideWorldRetrieval(query, {
    forceWorld: overrides.forceWorld,
  });

  const includeWorld =
    overrides.includeWorld !== undefined
      ? overrides.includeWorld
      : worldDecision.includeWorld;

  return createRetrievalPlan({
    query,
    actorKey,
    chatId: input.chatId ?? null,
    intent: overrides.intent ?? intent,
    includeConversation: overrides.includeConversation !== false,
    includePersonal: overrides.includePersonal !== false,
    includeReasoning: overrides.includeReasoning !== false,
    includeWorld,
    includeDomains: overrides.includeDomains !== false,
    domains: overrides.domains ?? domains,
    worldRetrievalReason: worldDecision.reason,
  });
}
