/**
 * Map Inbox informationKinds (+ optional execution summary) to dashboard activity domain.
 * Prefer persisted finance/task domains over free-text idea heuristics.
 */

/**
 * @param {string[]} kinds
 * @param {{ executionSummary?: unknown, originalText?: string }} [hints]
 * @returns {"expense"|"income"|"task"|"idea"|"knowledge"|"memory"}
 */
export function resolveActivityDomain(kinds = [], hints = {}) {
  const list = Array.isArray(kinds) ? kinds.map(String) : [];
  const summary = hints.executionSummary;
  const summaryText =
    typeof summary === "string"
      ? summary
      : summary && typeof summary === "object"
        ? JSON.stringify(summary)
        : "";

  if (
    /expense_saved|income_saved|finance_expense|finance_income|"finance"/i.test(
      summaryText
    ) ||
    list.includes("finance")
  ) {
    if (/income_saved|finance_income/i.test(summaryText)) return "income";
    return "expense";
  }
  if (list.includes("task")) return "task";
  if (list.includes("knowledge")) return "knowledge";
  if (list.includes("memory")) return "memory";
  if (list.includes("idea")) return "idea";
  return "idea";
}

/**
 * Human subtitle for activity domain.
 * @param {string} domain
 */
export function activityDomainLabel(domain) {
  switch (domain) {
    case "expense":
    case "income":
    case "finance":
      return "Финансы";
    case "task":
      return "Задача";
    case "knowledge":
      return "Знания";
    case "memory":
      return "Память";
    case "idea":
    default:
      return "Идея";
  }
}
