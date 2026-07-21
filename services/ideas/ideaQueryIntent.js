/**
 * Ideas read/search intent — punctuation-independent, pure helpers.
 * Used by Tier-0 router, Answer planner, Ideas experience route, Knowledge gate.
 *
 * Note: avoid JS \\b with Cyrillic — it does not bound Cyrillic letters.
 */

import { IDEA_CATEGORIES, normalizeIdeaCategory } from "./ideaContracts.js";

const CATEGORY_HINTS = Object.freeze([
  { category: "business", re: /бизнес|business|стартап|startup/iu },
  { category: "content", re: /контент|content|youtube|видео|блог/iu },
  { category: "project", re: /проект|project|продукт|product/iu },
  { category: "sport", re: /спорт|sport|тренир|workout|gym/iu },
  { category: "health", re: /здоров|health|whoop/iu },
  { category: "learning", re: /обучен|learning|курс|учить/iu },
  { category: "travel", re: /путешеств|travel|вьетнам|vietnam/iu },
  { category: "finance", re: /финанс|finance|бюджет|инвест/iu },
  { category: "life", re: /жизнь|life|быт/iu },
  { category: "observation", re: /наблюден|observation/iu },
]);

/**
 * Strip trailing/embedded question punctuation for stable matching.
 * @param {string} text
 * @returns {string}
 */
export function normalizeIdeaQueryText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[?！؟]/gu, " ")
    .replace(/[.!…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Broad list / “my ideas” intents (no category required).
 * @param {string} text
 * @returns {boolean}
 */
export function isIdeasListQuery(text) {
  const n = normalizeIdeaQueryText(text);
  if (!n) return false;

  if (
    /^(какие\s+)?(у\s+меня\s+)?идеи$/u.test(n) ||
    /^какие\s+идеи\s+у\s+меня$/u.test(n) ||
    /^мои\s+идеи$/u.test(n) ||
    /^покажи\s+мои\s+идеи$/u.test(n) ||
    /^список\s+идей$/u.test(n) ||
    /^что\s+я\s+придумал(?:а)?$/u.test(n) ||
    /^what\s+ideas\s+do\s+i\s+have$/u.test(n) ||
    /^my\s+ideas$/u.test(n) ||
    /^show\s+(me\s+)?my\s+ideas$/u.test(n)
  ) {
    return true;
  }

  return false;
}

/**
 * Open one idea by 1-based list index.
 * @param {string} text
 * @returns {boolean}
 */
export function isIdeasOpenQuery(text) {
  return extractIdeaOpenIndex(text) != null;
}

/**
 * @param {string} text
 * @returns {number|null} 1-based index
 */
export function extractIdeaOpenIndex(text) {
  const n = normalizeIdeaQueryText(text);
  if (!n) return null;

  const patterns = [
    /^(?:открой|открыть|покажи)\s+идею\s+(\d+)\s*$/u,
    /^подробнее\s+про\s+идею\s+(\d+)\s*$/u,
    /^идея\s+(\d+)\s*$/u,
    /^(?:open|show)\s+idea\s+(\d+)\s*$/u,
  ];

  for (const re of patterns) {
    const m = re.exec(n);
    if (m) {
      const index = Number(m[1]);
      if (Number.isFinite(index) && index >= 1) return index;
    }
  }
  return null;
}

/**
 * Topic/category search (not bare list, not open-by-index).
 * @param {string} text
 * @returns {boolean}
 */
export function isIdeasSearchQuery(text) {
  const n = normalizeIdeaQueryText(text);
  if (!n) return false;
  if (isIdeasListQuery(n) || isIdeasOpenQuery(n)) return false;
  if (/знани/u.test(n)) return false;

  if (
    /^(покажи|найди|найти|открой|открыть|show|find)\s+(мои\s+)?идеи(?:\s|$)/u.test(
      n
    ) ||
    /^идеи\s+(про|для|about|on|связанн)(?:\s|$)/u.test(n) ||
    /^(какие|какая|какой)\s+идеи?(?:\s|$)/u.test(n) ||
    /идеи\s+(про|для|about|on|связанн)/u.test(n) ||
    /ideas?\s+(about|on|for|related)/u.test(n) ||
    /связан[а-я]*\s+с\s+/u.test(n) && /иде/u.test(n)
  ) {
    return true;
  }

  return false;
}

/**
 * Any Ideas retrieval (list / open / search) — must beat Knowledge.
 * @param {string} text
 * @returns {boolean}
 */
export function isIdeasRetrievalQuery(text) {
  const n = normalizeIdeaQueryText(text);
  if (!n) return false;
  if (/знани/u.test(n) && !/иде/u.test(n)) return false;
  return (
    isIdeasListQuery(n) || isIdeasOpenQuery(n) || isIdeasSearchQuery(n)
  );
}

/**
 * Distinguish list / open / search / general for Ideas domain routing.
 * @param {string} text
 * @returns {{ kind: 'list'|'open'|'search'|null, index: number|null, category: string|null, query: string }}
 */
export function classifyIdeasReadIntent(text) {
  const trimmed = String(text ?? "").trim();
  const query = trimmed;
  const category = extractIdeaCategoryFilter(trimmed);

  if (isIdeasOpenQuery(trimmed)) {
    return {
      kind: "open",
      index: extractIdeaOpenIndex(trimmed),
      category: null,
      query,
    };
  }

  if (isIdeasListQuery(trimmed)) {
    return {
      kind: "list",
      index: null,
      category: null,
      query,
    };
  }

  if (isIdeasSearchQuery(trimmed)) {
    return {
      kind: "search",
      index: null,
      category,
      query,
    };
  }

  return { kind: null, index: null, category: null, query };
}

/**
 * Extract canonical category filter from an ideas query, if any.
 * @param {string} text
 * @returns {string|null}
 */
export function extractIdeaCategoryFilter(text) {
  const n = normalizeIdeaQueryText(text);
  if (!n || !/(иде[яи]|ideas?)/u.test(n)) return null;

  for (const { category, re } of CATEGORY_HINTS) {
    if (re.test(n)) return category;
  }

  for (const cat of IDEA_CATEGORIES) {
    if (cat === "other") continue;
    if (n.includes(cat)) {
      return normalizeIdeaCategory(cat);
    }
  }

  return null;
}

/**
 * Free-text topic tokens for keyword search (beyond category words).
 * @param {string} text
 * @returns {string}
 */
export function extractIdeaSearchTopic(text) {
  let n = normalizeIdeaQueryText(text);
  n = n
    .replace(
      /(покажи|найди|найти|открой|открыть|мои|идеи|ideas?|про|для|about|on|у|меня|какие|какая|какой|связан[а-я]*|с|show|find|related|to)/gu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  for (const { category, re } of CATEGORY_HINTS) {
    if (re.test(n)) {
      n = n.replace(re, " ").replace(/\s+/g, " ").trim();
      void category;
    }
  }

  return n;
}

/**
 * Knowledge open-by-index: "открыть 4", "покажи 3", "покажи знание 3".
 * @param {string} text
 * @returns {boolean}
 */
export function isKnowledgeOpenCommand(text) {
  const n = normalizeIdeaQueryText(text);
  if (!n) return false;
  if (isIdeasRetrievalQuery(n)) return false;
  return /^(?:открой|открыть|покажи|показать)(?:\s+знание)?\s+\d+\s*$/u.test(n) ||
    /^знание\s+\d+\s*$/u.test(n);
}

/**
 * Knowledge list: "мои знания", "покажи мои знания".
 * @param {string} text
 * @returns {boolean}
 */
export function isKnowledgeListCommand(text) {
  const n = normalizeIdeaQueryText(text);
  return /^(покажи\s+)?мои\s+знания$/u.test(n);
}

/**
 * Parse index from knowledge open command.
 * @param {string} text
 * @returns {number|null}
 */
export function extractKnowledgeIndex(text) {
  const n = normalizeIdeaQueryText(text);
  const m =
    /^(?:открой|открыть|покажи|показать)(?:\s+знание)?\s+(\d+)\s*$/u.exec(n) ||
    /^знание\s+(\d+)\s*$/u.exec(n);
  if (!m) return null;
  const index = Number(m[1]);
  return Number.isFinite(index) ? index : null;
}

/**
 * Keep idea if it matches category filter or text/tag relevance.
 * @param {object} idea
 * @param {string|null} category
 * @param {string} query
 * @returns {boolean}
 */
export function ideaMatchesCategoryFilter(idea, category, query = "") {
  if (!category) return true;
  const cat = normalizeIdeaCategory(category);
  if (normalizeIdeaCategory(idea?.category) === cat) return true;

  const hay = `${idea?.normalizedText || ""} ${idea?.originalText || ""} ${(idea?.tags || []).join(" ")}`.toLowerCase();
  const hints = CATEGORY_HINTS.find((h) => h.category === cat);
  if (hints?.re.test(hay)) return true;

  const q = extractIdeaSearchTopic(query);
  if (q.length >= 3 && hay.includes(q)) return true;

  return false;
}
