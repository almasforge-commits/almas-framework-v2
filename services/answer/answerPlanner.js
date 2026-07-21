/**
 * Answer planner — deterministic intent + which services participate.
 * Does not call LLM. Does not execute domains.
 */

import { createRetrievalPlan } from "./answerContracts.js";
import { decideWorldRetrieval } from "./worldRetrievalDecision.js";
import {
  classifyIdeasReadIntent,
  isIdeasRetrievalQuery,
} from "../ideas/ideaQueryIntent.js";

const FINANCE_HINT =
  /баланс|расход|доход|статистик|истори|потрат|finance|balance|expense|income|expenses?/i;
// Avoid JS \b with Cyrillic — it treats letters as non-word chars.
const TASK_HINT = /задач|tasks?|todo|напомни|купить|сделать/i;
const KNOWLEDGE_HINT = /знани|knowledge|whoop/i;
const KNOWLEDGE_SHOW_HINT = /найди|найти|открой|покажи/i;
const PREFERENCE_HINT =
  /предпочтен|нравит|dislikes?|likes?\b|favourite|favorite|привыч|habit|working\s+style|стиль\s+работ/i;
const ABOUT_ME_HINT =
  /обо\s+мне|о\s+себе|about\s+me|who\s+am\s+i|know\s+about\s+me/i;
const MEMORY_HINT = /вспомни|памят|memory/i;
const IDEA_HINT =
  /иде[яи]|ideas?|мысли|контент.?иде|startup.?ide|бизнес.?иде/i;

/**
 * Map Ideas read subtype → planner intent.
 * @param {string} query
 * @returns {string|null}
 */
function ideasIntentFromQuery(query) {
  const read = classifyIdeasReadIntent(query);
  if (read.kind === "list") return "ideas_list";
  if (read.kind === "open") return "ideas_open";
  if (read.kind === "search") return "ideas_search";
  if (isIdeasRetrievalQuery(query) || IDEA_HINT.test(query)) return "ideas_query";
  return null;
}

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
  const ideasIntent = ideasIntentFromQuery(query);
  const wantsIdeas = Boolean(ideasIntent);
  // "покажи" alone is not Knowledge when the query is Ideas-scoped.
  const wantsKnowledge =
    KNOWLEDGE_HINT.test(query) ||
    (KNOWLEDGE_SHOW_HINT.test(query) && !wantsIdeas);
  const wantsPreferences = PREFERENCE_HINT.test(query);
  const wantsAboutMe = ABOUT_ME_HINT.test(query);
  const wantsMemory = MEMORY_HINT.test(query);

  const domains = [];
  let intent = "general";

  // Preference / about-me are scoped: do not pull tasks/finance/knowledge
  // unless the query also asks for those domains explicitly.
  const preferenceScoped =
    wantsPreferences && !wantsFinance && !wantsTasks && !wantsKnowledge && !wantsIdeas;
  const aboutMeScoped =
    wantsAboutMe &&
    !wantsFinance &&
    !wantsTasks &&
    !wantsKnowledge &&
    !wantsPreferences &&
    !wantsIdeas;
  const ideasScoped =
    wantsIdeas && !wantsFinance && !wantsTasks && !wantsKnowledge;

  if (preferenceScoped) {
    intent = "preferences_query";
    domains.push("memory");
  } else if (aboutMeScoped) {
    intent = "about_me_query";
    domains.push("memory");
  } else if (ideasScoped) {
    intent = ideasIntent || "ideas_query";
    domains.push("ideas");
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
    if (wantsIdeas) {
      if (intent === "general") intent = ideasIntent || "ideas_query";
      domains.push("ideas");
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
