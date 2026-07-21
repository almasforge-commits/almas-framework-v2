import {
  sendMainMenu,
  sendKnowledgeAll,
  sendKnowledgeSearchInstruction,
  sendCompletedTasksList,
  sendFinanceHistory,
  sendFinanceStatistics,
  sendMemoryRecallInstruction,
  sendMemorySearchInstruction,
  sendMemorySaveInstruction,
  sendMemoryHelp,
  sendMemoryMenu,
  sendIdeasMenu,
  sendIdeasSearchInstruction,
  sendIdeasNewInstruction,
  sendIdeasHelp,
} from "./routes/menuRoute.js";
import { handleIdeaCategoryCallback } from "./routes/ideaRoute.js";
import { buildActorFromTelegram } from "../services/inbox/inboxContracts.js";
import {
  CAPTURE_CALLBACK,
  maybeHandleCaptureSessionTurn,
} from "./routes/captureRoute.js";

// Dispatch table for every inline-keyboard button this app currently
// sends (see handlers/keyboards/mainMenu.js). Deliberately a flat,
// static map — no free-form callback_data is ever accepted.
function buildHandlers(sendMessageFn) {
  return {
    "menu:home": (chatId, userId, actorKey) =>
      sendMainMenu(chatId, { sendMessageFn, actorKey }),
    "menu:knowledge:all": (chatId, userId, actorKey) =>
      sendKnowledgeAll(chatId, { sendMessageFn, actorKey }),
    "menu:knowledge:search": (chatId) =>
      sendKnowledgeSearchInstruction(chatId, { sendMessageFn }),
    "menu:tasks:done": (chatId) =>
      sendCompletedTasksList(chatId, { sendMessageFn }),
    "menu:finance:history": (chatId, userId) =>
      sendFinanceHistory(chatId, userId, { sendMessageFn }),
    "menu:finance:stats": (chatId, userId) =>
      sendFinanceStatistics(chatId, userId, { sendMessageFn }),
    "menu:memory:recall": (chatId) =>
      sendMemoryRecallInstruction(chatId, { sendMessageFn }),
    "menu:memory:search": (chatId) =>
      sendMemorySearchInstruction(chatId, { sendMessageFn }),
    "menu:memory:save": (chatId) =>
      sendMemorySaveInstruction(chatId, { sendMessageFn }),
    "menu:memory:help": (chatId) =>
      sendMemoryHelp(chatId, { sendMessageFn }),
    "menu:ideas:search": (chatId) =>
      sendIdeasSearchInstruction(chatId, { sendMessageFn }),
    "menu:ideas:new": (chatId) =>
      sendIdeasNewInstruction(chatId, { sendMessageFn }),
    "menu:ideas:help": (chatId) =>
      sendIdeasHelp(chatId, { sendMessageFn }),
    "menu:ideas:cat:content": (chatId, userId, actorKey) =>
      sendIdeasMenu(chatId, {
        sendMessageFn,
        actorKey,
        userId,
        category: "content",
      }),
    "menu:ideas:cat:business": (chatId, userId, actorKey) =>
      sendIdeasMenu(chatId, {
        sendMessageFn,
        actorKey,
        userId,
        category: "business",
      }),
    "menu:ideas:cat:project": (chatId, userId, actorKey) =>
      sendIdeasMenu(chatId, {
        sendMessageFn,
        actorKey,
        userId,
        category: "project",
      }),
    "menu:ideas:cat:other": (chatId, userId, actorKey) =>
      sendIdeasMenu(chatId, {
        sendMessageFn,
        actorKey,
        userId,
        category: "other",
      }),
    "menu:ideas": (chatId, userId, actorKey) =>
      sendIdeasMenu(chatId, { sendMessageFn, actorKey, userId }),
    "menu:memory": (chatId, userId, actorKey) =>
      sendMemoryMenu(chatId, { sendMessageFn, userId, actorKey }),
  };
}

let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

/**
 * Handles one Telegram callback_query for the navigation menu and
 * Ideas category corrections. Never throws.
 *
 * @param {object} query - node-telegram-bot-api CallbackQuery.
 * @param {object} [options] - Dependency injection for isolated tests.
 */
export async function handleMenuCallback(query, options = {}) {
  const {
    sendMessageFn = async (chatId, text, extra) =>
      (await getBot()).sendMessage(chatId, text, extra),
    answerCallbackQueryFn = async (id, opts) =>
      (await getBot()).answerCallbackQuery(id, opts),
  } = options;

  const chatId = query?.message?.chat?.id;
  const from = query?.from;
  const userId = String(from?.id ?? "default");
  const actor = buildActorFromTelegram(from, chatId);
  const actorKey = actor?.actorKey ?? null;
  const data = String(query?.data ?? "");

  try {
    if (data.startsWith("idea:cat:")) {
      await handleIdeaCategoryCallback(query, {
        sendMessageFn,
        answerCallbackQueryFn,
      });
      return;
    }

    if (
      data === CAPTURE_CALLBACK.confirm ||
      data === CAPTURE_CALLBACK.edit ||
      data === CAPTURE_CALLBACK.cancel
    ) {
      await maybeHandleCaptureSessionTurn(
        {
          chatId,
          text: null,
          from,
          actor,
          callbackData: data,
        },
        { sendMessageFn }
      );
      return;
    }

    if (chatId != null) {
      const handler = buildHandlers(sendMessageFn)[data];

      if (handler) {
        await handler(chatId, userId, actorKey);
      }
    }
  } catch (error) {
    console.error("[menu] callback handling failed:", error?.message || error);

    if (chatId != null) {
      await sendMessageFn(
        chatId,
        "⚠️ Не удалось загрузить данные. Попробуй позже."
      ).catch(() => {});
    }
  } finally {
    if (!data.startsWith("idea:cat:")) {
      await answerCallbackQueryFn(query?.id).catch(() => {});
    }
  }
}

export function registerCallbackHandler() {
  getBot().then((bot) => {
    bot.on("callback_query", (query) => {
      handleMenuCallback(query).catch((error) => {
        console.error(
          "[menu] unhandled callback error:",
          error?.message || error
        );
      });
    });
  });
}
