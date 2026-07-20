/**
 * Format Answer Engine result for Telegram — read-only text only.
 * Never invents facts beyond engine output.
 */

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
