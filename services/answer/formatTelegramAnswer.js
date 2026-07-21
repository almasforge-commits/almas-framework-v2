/**
 * Format Answer Engine result for Telegram — read-only text only.
 * Ideas domain intents use Ideas formatters (not the generic prose wrapper).
 */

import { formatIdeaSearch } from "../ideas/ideaFormatters.js";

const IDEAS_INTENTS = new Set([
  "ideas_list",
  "ideas_open",
  "ideas_search",
  "ideas_query",
]);

/**
 * @param {object} result - createAnswerResult shape
 * @returns {string}
 */
export function formatTelegramAnswerReply(result) {
  if (!result || typeof result !== "object") {
    return "Пока я этого не знаю.";
  }

  if (result.needsClarification) {
    const q =
      typeof result.clarificationQuestion === "string" &&
      result.clarificationQuestion.trim()
        ? result.clarificationQuestion.trim()
        : "Уточните вопрос, пожалуйста.";
    return q;
  }

  const answer =
    typeof result.answer === "string" && result.answer.trim()
      ? result.answer.trim()
      : "";

  if (!answer) {
    return "Пока я этого не знаю.";
  }

  const intent = String(result.intent || "");
  const ideasOnly =
    IDEAS_INTENTS.has(intent) ||
    (Array.isArray(result.usedDomains) &&
      result.usedDomains.length === 1 &&
      result.usedDomains[0] === "ideas");

  if (ideasOnly) {
    // Reconstruct a numbered Ideas search view from evidence lines.
    const ideas = (Array.isArray(result.sources) ? result.sources : [])
      .filter((s) => String(s.domain || "").startsWith("ideas/"))
      .map((s, i) => ({
        title: extractIdeaTitleFromAnswer(answer, i),
        normalizedText: extractIdeaTitleFromAnswer(answer, i),
        category: String(s.domain || "ideas/other").replace(/^ideas\//, ""),
      }));

    if (ideas.length) {
      return formatIdeaSearch({ ideas, query: "", category: null });
    }

    // Fallback: keep Idea lines without the generic Answer chrome.
    const lines = answer
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return ["💡", "", ...lines.map((l, i) => `${i + 1}. ${stripTrailingDot(l)}`)].join(
      "\n"
    );
  }

  const confidence = Number(result.confidence);
  const confLine = Number.isFinite(confidence)
    ? `\n\nУверенность: ${Math.round(confidence * 100)}%`
    : "";

  let conflictLine = "";
  if (Array.isArray(result.conflicts) && result.conflicts.length > 0) {
    conflictLine =
      "\n\n⚠️ Есть противоречия в данных — приоритет у личных фактов.";
  }

  const sources = Array.isArray(result.sources) ? result.sources : [];
  const sourceLines = sources
    .slice(0, 8)
    .map((s) => {
      const scope = s.scope || "?";
      const domain = s.domain ? `/${s.domain}` : "";
      const prov =
        scope === "world" && s.source
          ? ` · ${s.source}`
          : "";
      return `• ${scope}${domain}${prov}`;
    })
    .join("\n");

  const sourcesBlock = sourceLines
    ? `\n\n━━━━━━━━━━━━━━\n📚 Источники\n${sourceLines}`
    : "";

  return `🧠 Ответ\n\n${answer}${confLine}${conflictLine}${sourcesBlock}`;
}

function extractIdeaTitleFromAnswer(answer, index) {
  const lines = String(answer || "")
    .split("\n")
    .map((l) => stripTrailingDot(l.trim()))
    .filter(Boolean);
  return lines[index] || lines[0] || "Идея";
}

function stripTrailingDot(s) {
  return String(s || "").replace(/\.+$/u, "");
}
