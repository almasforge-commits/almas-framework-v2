// Rendering boundary for AI-router active-mode execution results.
// services/inbox/actionExecutor.js stays Telegram-independent — it only
// ever returns structured `{ action, executed, reason }` results (see
// getExecutedOwnedActions() in services/inbox/routingDecisionService.js).
// This module is the only place that turns those results into Telegram
// text and sends them; actionExecutor.js/routingDecisionService.js never
// import bot.js.

// Importing config/bot.js constructs a real, polling TelegramBot as a
// module-level side effect (same reasoning as handlers/routes/
// voiceRoute.js / menuRoute.js) — deferred via a lazy dynamic import so
// isolated tests (which always inject sendMessageFn) never touch the
// real Telegram client.
let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

const defaultSendMessageFn = async (chatId, text) => (await getBot()).sendMessage(chatId, text);

/**
 * Renders exactly one executed action into its user-visible Telegram
 * confirmation text, or null if the type isn't one this module knows how
 * to confirm (defense in depth — callers are expected to only ever pass
 * executed task_create/memory_save results here in the first place).
 *
 * @param {{ action: object, executed: boolean, reason: string }} result
 * @returns {string|null}
 */
export function formatAiExecutionConfirmation(result) {
  const action = result?.action;

  if (!action) return null;

  if (action.type === "task_create") {
    const content = (action.payload?.content ?? "").trim();
    return content ? `✅ Задача сохранена\n\n${content}` : "✅ Задача сохранена";
  }

  if (action.type === "memory_save") {
    return "🧠 Запомнил.";
  }

  return null;
}

/**
 * Renders every executed action in `executedActions` into its
 * confirmation text, in the same order they were executed. Skips (does
 * not render a blank/placeholder message for) any result this module
 * doesn't know how to confirm.
 *
 * @param {{ action: object, executed: boolean, reason: string }[]} executedActions
 * @returns {string[]}
 */
export function formatAiExecutionConfirmations(executedActions) {
  return (Array.isArray(executedActions) ? executedActions : [])
    .map(formatAiExecutionConfirmation)
    .filter((text) => Boolean(text));
}

/**
 * Sends one Telegram message per executed action's confirmation, in
 * order. Never throws — a send failure for one confirmation is logged
 * and does not stop the remaining ones.
 *
 * @param {number|string} chatId
 * @param {{ action: object, executed: boolean, reason: string }[]} executedActions
 * @param {object} [options] - Dependency injection for isolated tests.
 * @param {Function} [options.sendMessageFn]
 * @returns {Promise<number>} how many confirmations were actually sent.
 */
export async function sendAiExecutionConfirmations(chatId, executedActions, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;

  const messages = formatAiExecutionConfirmations(executedActions);

  let sentCount = 0;

  for (const message of messages) {
    try {
      await sendMessageFn(chatId, message);
      sentCount += 1;
    } catch (error) {
      console.error("[ai-router] failed to send an execution confirmation:", error?.message || error);
    }
  }

  return sentCount;
}
