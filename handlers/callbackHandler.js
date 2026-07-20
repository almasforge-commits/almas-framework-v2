import {
  sendMainMenu,
  sendKnowledgeAll,
  sendKnowledgeSearchInstruction,
  sendCompletedTasksList,
  sendFinanceHistory,
  sendFinanceStatistics,
  sendMemoryRecallInstruction,
  sendMemorySearchInstruction,
} from "./routes/menuRoute.js";

// Dispatch table for every inline-keyboard button this app currently
// sends (see handlers/keyboards/mainMenu.js). Deliberately a flat,
// static map — no free-form callback_data is ever accepted.
function buildHandlers(sendMessageFn) {
  return {
    "menu:home": (chatId) => sendMainMenu(chatId, { sendMessageFn }),
    "menu:knowledge:all": (chatId) => sendKnowledgeAll(chatId, { sendMessageFn }),
    "menu:knowledge:search": (chatId) => sendKnowledgeSearchInstruction(chatId, { sendMessageFn }),
    "menu:tasks:done": (chatId) => sendCompletedTasksList(chatId, { sendMessageFn }),
    "menu:finance:history": (chatId, userId) => sendFinanceHistory(chatId, userId, { sendMessageFn }),
    "menu:finance:stats": (chatId, userId) => sendFinanceStatistics(chatId, userId, { sendMessageFn }),
    "menu:memory:recall": (chatId) => sendMemoryRecallInstruction(chatId, { sendMessageFn }),
    "menu:memory:search": (chatId) => sendMemorySearchInstruction(chatId, { sendMessageFn }),
  };
}

// Importing config/bot.js constructs a real, polling TelegramBot as a
// module-level side effect — deferred via a lazy dynamic import so
// isolated tests (which always inject sendMessageFn/answerCallbackQueryFn)
// never touch the real Telegram client.
let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

/**
 * Handles one Telegram callback_query for the navigation menu. Never
 * throws — an unknown callback_data is ignored, and a handler failure is
 * logged, not propagated — but always acknowledges the query so
 * Telegram clears the button's loading spinner.
 *
 * @param {object} query - node-telegram-bot-api CallbackQuery.
 * @param {object} [options] - Dependency injection for isolated tests.
 */
export async function handleMenuCallback(query, options = {}) {
  const {
    sendMessageFn = async (chatId, text, extra) => (await getBot()).sendMessage(chatId, text, extra),
    answerCallbackQueryFn = async (id) => (await getBot()).answerCallbackQuery(id),
  } = options;

  const chatId = query?.message?.chat?.id;
  const userId = String(query?.from?.id ?? "default");

  try {
    if (chatId != null) {
      const handler = buildHandlers(sendMessageFn)[query?.data];

      if (handler) {
        await handler(chatId, userId);
      }
    }
  } catch (error) {
    console.error("[menu] callback handling failed:", error?.message || error);

    if (chatId != null) {
      await sendMessageFn(chatId, "⚠️ Не удалось загрузить данные. Попробуй позже.").catch(() => {});
    }
  } finally {
    await answerCallbackQueryFn(query?.id).catch(() => {});
  }
}

export function registerCallbackHandler() {
  getBot().then((bot) => {
    bot.on("callback_query", (query) => {
      handleMenuCallback(query).catch((error) => {
        console.error("[menu] unhandled callback error:", error?.message || error);
      });
    });
  });
}
