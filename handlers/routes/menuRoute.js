import { ALMAS_WEB_APP_URL } from "../../config/webapp.js";
import {
  createMiniAppButton,
  isPrivateChatType,
  MINI_APP_PATHS,
  THIN_CONFIRM,
} from "../../config/deepLinks.js";
import {
  buildMainMenuKeyboard,
  buildHomeOnlyKeyboard,
  buildKnowledgeMenuKeyboard,
  buildTasksMenuKeyboard,
  buildFinanceMenuKeyboard,
  buildMemoryMenuKeyboard,
  buildIdeasMenuKeyboard,
  buildIdeasEmptyMenuKeyboard,
  MENU_BUTTON_LABELS,
} from "../keyboards/mainMenu.js";
import { defaultNavigationContextStore } from "../../services/navigation/navigationContextStore.js";
import { setNavigationListContext } from "../../services/navigation/navigationRoute.js";

// Section menus are Telegram-thin: short teasers + Mini App deep links.
// Domain lists/history/analytics live in the Mini App.
//
// Importing config/bot.js constructs a real, polling TelegramBot as a
// module-level side effect (same reasoning as handlers/routes/voiceRoute.js)
// — deferred via a lazy dynamic import so isolated tests (which always
// inject sendMessageFn) never touch the real Telegram client.
let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

const defaultSendMessageFn = async (chatId, text, extra) => (await getBot()).sendMessage(chatId, text, extra);

export const MAIN_MENU_GREETING =
  "👋 ALMAS готов.\n\nПросто напишите или скажите, что хотите сохранить или сделать.";

export const FALLBACK_PROMPT =
  "Не понял запрос. Напишите иначе или откройте ALMAS 👇";

export async function sendMainMenu(chatId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    actorKey = null,
    navigationStore = defaultNavigationContextStore,
  } = options;
  if (actorKey) {
    navigationStore.clear(actorKey, chatId);
  }
  const { reply_markup } = buildMainMenuKeyboard();
  await sendMessageFn(chatId, MAIN_MENU_GREETING, { reply_markup });
}

export async function sendFallback(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildMainMenuKeyboard();
  await sendMessageFn(chatId, FALLBACK_PROMPT, { reply_markup });
}

export async function sendKnowledgeMenu(chatId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    actorKey = null,
    navigationStore = defaultNavigationContextStore,
  } = options;
  const { reply_markup } = buildKnowledgeMenuKeyboard();

  if (actorKey) {
    setNavigationListContext(navigationStore, actorKey, chatId, "knowledge", []);
  }

  await sendMessageFn(
    chatId,
    "📚 Knowledge\n\nOpen ALMAS →",
    { reply_markup }
  );
}

export async function sendKnowledgeAll(chatId, options = {}) {
  return sendKnowledgeMenu(chatId, options);
}

export async function sendKnowledgeSearchInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(chatId, "🔎 Напиши: найди <запрос>", { reply_markup });
}

export async function sendTasksMenu(chatId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    actorKey = null,
    navigationStore = defaultNavigationContextStore,
  } = options;
  const { reply_markup } = buildTasksMenuKeyboard();

  if (actorKey) {
    setNavigationListContext(navigationStore, actorKey, chatId, "tasks", []);
  }

  await sendMessageFn(
    chatId,
    "📋 Tasks\n\nOpen ALMAS →",
    { reply_markup }
  );
}

export async function sendCompletedTasksList(chatId, options = {}) {
  return sendTasksMenu(chatId, options);
}

export async function sendFinanceMenu(chatId, userId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    actorKey = null,
    navigationStore = defaultNavigationContextStore,
  } = options;
  const { reply_markup } = buildFinanceMenuKeyboard();

  if (actorKey) {
    setNavigationListContext(navigationStore, actorKey, chatId, "finance", [], {
      screen: "summary",
    });
  }

  await sendMessageFn(
    chatId,
    "💰 Finance\n\nOpen ALMAS →",
    { reply_markup }
  );
}

export async function sendFinanceHistory(chatId, userId, options = {}) {
  return sendFinanceMenu(chatId, userId, options);
}

export async function sendFinanceStatistics(chatId, userId, options = {}) {
  return sendFinanceMenu(chatId, userId, options);
}

export async function sendMemoryMenu(chatId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    actorKey = null,
    navigationStore = defaultNavigationContextStore,
  } = options;
  const { reply_markup } = buildMemoryMenuKeyboard();

  if (actorKey) {
    setNavigationListContext(navigationStore, actorKey, chatId, "memory", []);
  }

  await sendMessageFn(
    chatId,
    "🧠 Memory\n\nOpen ALMAS →",
    { reply_markup }
  );
}

export async function sendMemoryRecallInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(chatId, "🔁 Напиши: вспомни <запрос>", { reply_markup });
}

export async function sendMemorySearchInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(chatId, "🔎 Напиши: найди <запрос>", { reply_markup });
}

export async function sendMemorySaveInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(
    chatId,
    "➕ Напишите:\n«Запомни, что...»",
    { reply_markup }
  );
}

export async function sendMemoryHelp(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(
    chatId,
    "🧠 Как работает память\n\n" +
      "Напишите «Запомни, что …» — ALMAS сохранит факт.\n" +
      "Спросите «Что ты знаешь обо мне?» или нажмите «Вспомнить».",
    { reply_markup }
  );
}

/**
 * Main-menu Ideas entry: thin Telegram teaser; lists live in Mini App.
 */
export async function sendIdeasMenu(chatId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    actorKey = null,
    navigationStore = defaultNavigationContextStore,
  } = options;

  const { reply_markup } = actorKey
    ? buildIdeasMenuKeyboard()
    : buildIdeasEmptyMenuKeyboard();

  if (actorKey) {
    setNavigationListContext(navigationStore, actorKey, chatId, "ideas", []);
  }

  await sendMessageFn(
    chatId,
    actorKey
      ? "💡 Ideas\n\nOpen ALMAS →"
      : [
          "💡 Пока идей нет.",
          "",
          "Напишите или скажите:",
          "«У меня идея...»",
        ].join("\n"),
    { reply_markup }
  );
}

/** @deprecated alias — main menu now opens the list via sendIdeasMenu */
export async function sendIdeasPlaceholder(chatId, options = {}) {
  return sendIdeasMenu(chatId, options);
}

export async function sendIdeasSearchInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(
    chatId,
    "🔍 Напишите:\n«Покажи идеи про …» или «Найди идеи про …»",
    { reply_markup }
  );
}

export async function sendIdeasNewInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(
    chatId,
    "➕ Напишите или скажите:\n«У меня идея...»",
    { reply_markup }
  );
}

export async function sendIdeasHelp(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(
    chatId,
    "💡 Как сохранять идеи\n\n" +
      "Просто напишите или скажите мысль — например «У меня идея…».\n" +
      "ALMAS сохранит и классифицирует сам.\n\n" +
      "Список: «Какие у меня идеи?»\n" +
      "Открыть: «Открой идею 2»",
    { reply_markup }
  );
}

export async function sendProjectsPlaceholder(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  await sendMessageFn(chatId, "🚀 Проекты — раздел готовится.");
}

export async function sendOpenAlmas(chatId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    webAppUrl = ALMAS_WEB_APP_URL,
    chatType = "private",
  } = options;

  if (!isPrivateChatType(chatType)) {
    await sendMessageFn(chatId, THIN_CONFIRM.openPrivately);
    return;
  }

  if (!webAppUrl) {
    await sendMessageFn(chatId, "Mini App пока не подключён.", {
      reply_markup: buildMainMenuKeyboard().reply_markup,
    });
    return;
  }

  // Always offer an inline web_app button. Reply-keyboard web_app can be
  // stale on the client if ALMAS_WEB_APP_URL was added after the keyboard
  // was first shown; plain `url` buttons must never be used (no initData).
  const openButton = createMiniAppButton({
    text: MENU_BUTTON_LABELS.openAlmas,
    path: MINI_APP_PATHS.home,
    baseUrl: webAppUrl,
  });

  if (!openButton) {
    await sendMessageFn(chatId, "Mini App пока не подключён.", {
      reply_markup: buildMainMenuKeyboard().reply_markup,
    });
    return;
  }

  await sendMessageFn(
    chatId,
    "🌐 Нажмите кнопку ниже, чтобы открыть ALMAS (авторизованная Mini App):",
    {
      reply_markup: {
        inline_keyboard: [[openButton]],
      },
    }
  );
}

export const HELP_ONBOARDING_MESSAGE = `❓ Как пользоваться ALMAS

Просто напишите или скажите голосом, что произошло.

Например:
• «Потратил 80 000 VND на кофе»
• «У меня идея снять ролик про Вьетнам»
• «Завтра позвонить Арману»
• «Запомни, что мне нравится работать ночью»
• Можно рассказать всё одним сообщением

ALMAS сам разберёт информацию и сохранит её в нужные разделы.

Просмотр и управление данными — в Mini App.`;

export async function sendHelp(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildMainMenuKeyboard();
  await sendMessageFn(chatId, HELP_ONBOARDING_MESSAGE, { reply_markup });
}
