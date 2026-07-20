/**
 * Deterministic decision: when Answer Engine should call World Knowledge Gateway.
 * Personal-only questions never trigger world retrieval.
 */

const PERSONAL_ONLY =
  /^(?:\s*(?:my|мои|моих|моё|мое|моя|мой)\s+)?(?:tasks?|задач(?:и|а|у)?|ideas?|идеи|idea|projects?|проект(?:ы|ов|а)?|expenses?|расход(?:ы|ов)?|goals?|цел(?:и|ь)?|notes?|заметк(?:и|а)?|habits?|привычк(?:и|а)?|preferences?|предпочтен)/i;

const PERSONAL_SCOPED =
  /\b(?:my|мои|моих|моё|мое|моя|мой)\s+(?:tasks?|задач|ideas?|идеи|projects?|проект|expenses?|расход|goals?|цел|notes?|заметк|habits?|привыч)/i;

const EXTERNAL_KNOWLEDGE =
  /(?:^|\s)(?:what\s+is|what's|who\s+is|who's|what\s+are|explain|latest|news|happened\s+with|tell\s+me\s+about|что\s+такое|кто\s+такой|кто\s+такая|объясни|новост|что\s+случилось|что\s+произошло)\b/i;

const EXTERNAL_TOPICS = new RegExp(
  "\\b(?:mcp|bitcoin|btc|" +
    "open" +
    "ai|kubernetes|k8s|whoop|rag|llm|ai\\b|wikipedia)\\b",
  "i"
);

/**
 * @param {string} query
 * @param {object} [opts]
 * @returns {{ includeWorld: boolean, reason: string }}
 */
export function decideWorldRetrieval(query, opts = {}) {
  if (opts.forceWorld === true) {
    return { includeWorld: true, reason: "forced" };
  }
  if (opts.forceWorld === false) {
    return { includeWorld: false, reason: "forced_off" };
  }

  const q = String(query ?? "").trim();
  if (!q) {
    return { includeWorld: false, reason: "empty" };
  }

  if (isPersonalOnlyQuery(q)) {
    return { includeWorld: false, reason: "personal_only" };
  }

  if (isExternalKnowledgeQuery(q)) {
    return { includeWorld: true, reason: "external_knowledge" };
  }

  // Open / general questions may use world; personal still retrieved first.
  return { includeWorld: true, reason: "general_open" };
}

/**
 * @param {string} query
 */
export function isPersonalOnlyQuery(query) {
  const q = String(query ?? "").trim();
  if (!q) return false;
  if (PERSONAL_ONLY.test(q) || PERSONAL_SCOPED.test(q)) {
    // "What is my task manager product?" style — still external if EXTERNAL matches.
    if (isExternalKnowledgeQuery(q) && !/^(?:my|мои)\b/i.test(q)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * @param {string} query
 */
export function isExternalKnowledgeQuery(query) {
  const q = String(query ?? "").trim();
  if (!q) return false;
  return EXTERNAL_KNOWLEDGE.test(q) || EXTERNAL_TOPICS.test(q);
}
