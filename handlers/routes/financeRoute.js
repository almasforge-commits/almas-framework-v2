/**
 * Thin Telegram finance query replies — detail lives in Mini App.
 */

import {
  MINI_APP_PATHS,
  THIN_CONFIRM,
  thinOpenReply,
} from "../../config/deepLinks.js";
import {
  deleteLastTransaction,
} from "../../services/finance/financeService.js";

let botPromise = null;
function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((m) => m.default);
  }
  return botPromise;
}

export async function handleFinanceQuery(chatId, userId, query, options = {}) {
  const sendMessageFn =
    options.sendMessageFn ||
    (async (c, t, extra) => (await getBot()).sendMessage(c, t, extra));

  if (query.intent === "delete_last") {
    const transactions = await deleteLastTransaction(userId);
    if (!transactions || transactions.length === 0) {
      await sendMessageFn(chatId, "История пуста.");
      return true;
    }
    const reply = thinOpenReply(
      `${THIN_CONFIRM.finance}\n\n${THIN_CONFIRM.openFinance}`,
      MINI_APP_PATHS.finance,
      THIN_CONFIRM.openFinance
    );
    await sendMessageFn(chatId, reply.text, {
      reply_markup: reply.reply_markup,
    });
    return true;
  }

  // All read intents: thin redirect to Mini App Finance.
  const readIntents = new Set([
    "balance",
    "statistics",
    "history",
    "category",
    "period",
    "analytics",
  ]);
  if (readIntents.has(query.intent) || query.intent) {
    const reply = thinOpenReply(
      `💰 Finance\n\n${THIN_CONFIRM.openFinance}`,
      MINI_APP_PATHS.finance,
      THIN_CONFIRM.openFinance
    );
    await sendMessageFn(chatId, reply.text, {
      reply_markup: reply.reply_markup,
    });
    return true;
  }

  return false;
}
