/**
 * Filter legacy memory rows by Answer Engine query intent.
 * Tasks/finance rows live in the same memories table — exclude them
 * from preference / about-me / general memory recall.
 */

import { normalizeMemoryFactContent } from "../storage/memoryFilter.js";
import {
  isNavigationOrSystemMemory,
  isUserFact,
} from "./memoryQuality.js";

/**
 * @param {object[]} rows
 * @param {string} intent
 * @returns {object[]}
 */
export function filterMemoriesForIntent(rows, intent) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const kind = String(intent || "general");

  return rows.filter((row) => {
    const content = normalizeMemoryFactContent(row?.content ?? row?.text ?? "");
    if (!content) return false;

    // Navigation/system labels never participate in personal recall.
    if (
      kind === "preferences_query" ||
      kind === "about_me_query" ||
      kind === "memory_query"
    ) {
      if (isNavigationOrSystemMemory(content)) return false;
    }

    if (isTaskMemoryRow(row, content)) {
      return kind === "task_query";
    }
    if (isFinanceLikeMemory(content)) {
      return kind === "finance_query";
    }

    if (kind === "preferences_query") {
      return isPreferenceLikeMemory(content) && isUserFact(content);
    }
    if (kind === "about_me_query" || kind === "memory_query") {
      return isUserFact(content);
    }

    // Other intents: still drop pure navigation labels from memory domain.
    if (isNavigationOrSystemMemory(content)) return false;
    return true;
  });
}

/**
 * @param {object} row
 * @param {string} content
 */
export function isTaskMemoryRow(row, content = "") {
  const meta =
    row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (meta.memoryType === "task" || meta.actionType === "task_create") {
    return true;
  }
  const text = String(content || row?.content || "");
  return /^(купи|купить|позвони|позвонить|сделать|нужно)\b/iu.test(text);
}

/**
 * @param {string} content
 */
export function isFinanceLikeMemory(content) {
  const text = String(content || "");
  return /^(потратил|потратить|расход|доход|оплатил|купил)\b/iu.test(text);
}

/**
 * @param {string} content
 */
export function isPreferenceLikeMemory(content) {
  return /нрав|предпочит|like|prefer|любл|люби|dislike|habit|привыч|favourite|favorite|работаю|работать|стиль/iu.test(
    String(content || "")
  );
}
