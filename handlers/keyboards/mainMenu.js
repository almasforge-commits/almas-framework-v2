import { ALMAS_WEB_APP_URL } from "../../config/webapp.js";
import {
  buildMiniAppWebAppButton,
  MINI_APP_PATHS,
  THIN_CONFIRM,
} from "../../config/deepLinks.js";

// Pure keyboard builders — no Telegram/bot import, so these are
// trivially unit-testable. Every function returns a plain
// { reply_markup } object, the exact shape node-telegram-bot-api's
// sendMessage(chatId, text, extra) expects as `extra`.

export const MENU_BUTTON_LABELS = {
  // Domain labels kept for typed-command / backward-compat routing only.
  // They are NOT on the persistent reply keyboard.
  knowledge: "📚 Знания",
  ideas: "💡 Идеи",
  tasks: "📋 Задачи",
  projects: "🚀 Проекты",
  finance: "💰 Финансы",
  memory: "🧠 Память",
  openAlmas: "🌐 Открыть ALMAS",
  help: "❓ Как пользоваться",
  /** @deprecated alias — still accepted as typed navigation */
  helpLegacy: "❓ Помощь",
  home: "🏠 Главная",
};

function withMiniAppRow(path, rows, label = THIN_CONFIRM.openAlmas) {
  const button = buildMiniAppWebAppButton(label, path);
  if (!button) return rows;
  return [[button], ...rows];
}

/**
 * Persistent thin-inbox reply keyboard (exactly two buttons).
 * "Открыть ALMAS" opens the Web App when ALMAS_WEB_APP_URL is set;
 * otherwise it is a plain text button handled by routeText → sendOpenAlmas.
 */
export function buildMainMenuKeyboard() {
  const openAlmasButton = ALMAS_WEB_APP_URL
    ? { text: MENU_BUTTON_LABELS.openAlmas, web_app: { url: ALMAS_WEB_APP_URL } }
    : { text: MENU_BUTTON_LABELS.openAlmas };

  return {
    reply_markup: {
      keyboard: [
        [openAlmasButton],
        [{ text: MENU_BUTTON_LABELS.help }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    },
  };
}

/**
 * Attach the persistent main reply keyboard when the outgoing message
 * does not already define reply_markup (inline or keyboard).
 * Inline-keyboard flows (Capture, category chips, deep links) are left
 * unchanged so navigation/capture context is not interrupted.
 *
 * @param {object} [extra]
 * @returns {object}
 */
export function attachPersistentMainKeyboard(extra = {}) {
  const options =
    extra && typeof extra === "object" && !Array.isArray(extra) ? { ...extra } : {};
  const rm = options.reply_markup;
  if (rm?.inline_keyboard || rm?.keyboard) {
    return options;
  }
  return {
    ...options,
    reply_markup: buildMainMenuKeyboard().reply_markup,
  };
}

/** A single inline "🏠 Главная" button — used by every stateless/drill-down reply. */
export function buildHomeOnlyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(MINI_APP_PATHS.home, [
        [{ text: MENU_BUTTON_LABELS.home, callback_data: "menu:home" }],
      ]),
    },
  };
}

export function buildKnowledgeMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(
        MINI_APP_PATHS.knowledge,
        [],
        THIN_CONFIRM.openKnowledge
      ),
    },
  };
}

export function buildTasksMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(
        MINI_APP_PATHS.tasks,
        [],
        THIN_CONFIRM.openTasks
      ),
    },
  };
}

export function buildFinanceMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(
        MINI_APP_PATHS.finance,
        [],
        THIN_CONFIRM.openFinance
      ),
    },
  };
}

export function buildMemoryMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(
        MINI_APP_PATHS.memory,
        [[{ text: "➕ Запомнить в чате", callback_data: "menu:memory:save" }]],
        THIN_CONFIRM.openMemory
      ),
    },
  };
}

export function buildIdeasMenuKeyboard(opts = {}) {
  const showCategories = opts.showCategories !== false;
  const rows = [
    [{ text: "➕ Новая идея в чате", callback_data: "menu:ideas:new" }],
  ];

  // Category chips remain as fast capture shortcuts; lists live in Mini App.
  if (showCategories) {
    rows.push([
      { text: "🎬 Контент", callback_data: "menu:ideas:cat:content" },
      { text: "💼 Бизнес", callback_data: "menu:ideas:cat:business" },
    ]);
    rows.push([
      { text: "🛠 Проекты", callback_data: "menu:ideas:cat:project" },
      { text: "✨ Другое", callback_data: "menu:ideas:cat:other" },
    ]);
  }

  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(
        MINI_APP_PATHS.ideas,
        rows,
        THIN_CONFIRM.openIdeas
      ),
    },
  };
}

/** Empty Ideas state — fewer actions. */
export function buildIdeasEmptyMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: withMiniAppRow(
        MINI_APP_PATHS.ideas,
        [[{ text: "➕ Новая идея в чате", callback_data: "menu:ideas:new" }]],
        THIN_CONFIRM.openIdeas
      ),
    },
  };
}
