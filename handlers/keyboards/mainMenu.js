import { ALMAS_WEB_APP_URL } from "../../config/webapp.js";

// Pure keyboard builders — no Telegram/bot import, so these are
// trivially unit-testable. Every function returns a plain
// { reply_markup } object, the exact shape node-telegram-bot-api's
// sendMessage(chatId, text, extra) expects as `extra`.

export const MENU_BUTTON_LABELS = {
  knowledge: "📚 Знания",
  ideas: "💡 Идеи",
  tasks: "📋 Задачи",
  projects: "🚀 Проекты",
  finance: "💰 Финансы",
  memory: "🧠 Память",
  openAlmas: "🌐 Открыть ALMAS",
  help: "❓ Помощь",
  home: "🏠 Главная",
};

/**
 * The persistent main menu (ReplyKeyboardMarkup), 2x4 grid. The "Открыть
 * ALMAS" button opens the Web App directly (client-side, no message sent
 * to the bot) only when a valid ALMAS_WEB_APP_URL is configured;
 * otherwise it's a plain button whose label routeText() intercepts.
 */
export function buildMainMenuKeyboard() {
  const openAlmasButton = ALMAS_WEB_APP_URL
    ? { text: MENU_BUTTON_LABELS.openAlmas, web_app: { url: ALMAS_WEB_APP_URL } }
    : { text: MENU_BUTTON_LABELS.openAlmas };

  return {
    reply_markup: {
      keyboard: [
        [{ text: MENU_BUTTON_LABELS.knowledge }, { text: MENU_BUTTON_LABELS.ideas }],
        [{ text: MENU_BUTTON_LABELS.tasks }, { text: MENU_BUTTON_LABELS.projects }],
        [{ text: MENU_BUTTON_LABELS.finance }, { text: MENU_BUTTON_LABELS.memory }],
        [openAlmasButton, { text: MENU_BUTTON_LABELS.help }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    },
  };
}

/** A single inline "🏠 Главная" button — used by every stateless/drill-down reply. */
export function buildHomeOnlyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: MENU_BUTTON_LABELS.home, callback_data: "menu:home" }]],
    },
  };
}

export function buildKnowledgeMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📚 Все знания", callback_data: "menu:knowledge:all" }],
        [{ text: "🔎 Поиск", callback_data: "menu:knowledge:search" }],
        [{ text: MENU_BUTTON_LABELS.home, callback_data: "menu:home" }],
      ],
    },
  };
}

export function buildTasksMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Выполненные", callback_data: "menu:tasks:done" }],
        [{ text: MENU_BUTTON_LABELS.home, callback_data: "menu:home" }],
      ],
    },
  };
}

export function buildFinanceMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📒 История", callback_data: "menu:finance:history" },
          { text: "📊 Статистика", callback_data: "menu:finance:stats" },
        ],
        [{ text: MENU_BUTTON_LABELS.home, callback_data: "menu:home" }],
      ],
    },
  };
}

export function buildMemoryMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔁 Вспомнить", callback_data: "menu:memory:recall" },
          { text: "🔎 Поиск", callback_data: "menu:memory:search" },
        ],
        [{ text: MENU_BUTTON_LABELS.home, callback_data: "menu:home" }],
      ],
    },
  };
}
