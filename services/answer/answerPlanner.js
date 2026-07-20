/**
 * Answer planner — deterministic intent + which services participate.
 * Does not call LLM. Does not execute domains.
 */

import { createRetrievalPlan } from "./answerContracts.js";
import { decideWorldRetrieval } from "./worldRetrievalDecision.js";

const FINANCE_HINT =
  /баланс|расход|доход|статистик|истори|потрат|finance|balance|expense|income|expenses?/i;
// Avoid JS \b with Cyrillic — it treats letters as non-word chars.
const TASK_HINT = /задач|tasks?|todo|напомни|купить|сделать/i;
const KNOWLEDGE_HINT = /знани|knowledge|найди|найти|открой|покажи|whoop/i;
const PREFERENCE_HINT =
  /предпочтен|нравит|dislikes?|likes?\b|favourite|favorite|привыч|habit|working\s+style|стиль\s+работ/i;
const ABOUT_ME_HINT =
  /обо\s+мне|о\s+себе|about\s+me|who\s+am\s+i|know\s+about\s+me/i;
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

  const wantsFinance = FINANCE_HINT.test(query);
  const wantsTasks = TASK_HINT.test(query);
  const wantsKnowledge = KNOWLEDGE_HINT.test(query);
  const wantsPreferences = PREFERENCE_HINT.test(query);
  const wantsAboutMe = ABOUT_ME_HINT.test(query);
  const wantsMemory = MEMORY_HINT.test(query);

  const domains = [];
  let intent = "general";

  // Preference / about-me are scoped: do not pull tasks/finance/knowledge
  // unless the query also asks for those domains explicitly.
  const preferenceScoped =
    wantsPreferences && !wantsFinance && !wantsTasks && !wantsKnowledge;
  const aboutMeScoped =
    wantsAboutMe &&
    !wantsFinance &&
    !wantsTasks &&
    !wantsKnowledge &&
    !wantsPreferences;

  if (preferenceScoped) {
    intent = "preferences_query";
    domains.push("memory");
  } else if (aboutMeScoped) {
    intent = "about_me_query";
    domains.push("memory");
  } else {
    if (wantsFinance) {
      intent = "finance_query";
      domains.push("finance");
    }
    if (wantsTasks) {
      if (intent === "general") intent = "task_query";
      domains.push("tasks");
    }
    if (wantsKnowledge && !wantsAboutMe) {
      if (intent === "general") intent = "knowledge_query";
      domains.push("knowledge");
    }
    if (wantsMemory || wantsPreferences || wantsAboutMe) {
      if (intent === "general") {
        intent = wantsPreferences
          ? "preferences_query"
          : wantsAboutMe
            ? "about_me_query"
            : "memory_query";
      }
      domains.push("memory");
    }
  }

  const worldDecision = decideWorldRetrieval(query, {
    forceWorld: overrides.forceWorld,
  });

  const includeWorld =
    overrides.includeWorld !== undefined
      ? overrides.includeWorld
      : worldDecision.includeWorld;

  const personalDefault =
    intent === "preferences_query" ||
    intent === "about_me_query" ||
    intent === "memory_query"
      ? true
      : undefined;

  return createRetrievalPlan({
    query,
    actorKey,
    chatId: input.chatId ?? null,
    intent: overrides.intent ?? intent,
    includeConversation: overrides.includeConversation !== false,
    includePersonal:
      overrides.includePersonal !== undefined
        ? overrides.includePersonal
        : personalDefault !== undefined
          ? personalDefault
          : true,
    includeReasoning: overrides.includeReasoning !== false,
    includeWorld,
    includeDomains: overrides.includeDomains !== false,
    domains: overrides.domains ?? domains,
    worldRetrievalReason: worldDecision.reason,
  });
}
