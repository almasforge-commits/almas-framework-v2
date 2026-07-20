import { ALMAS_WEB_APP_URL } from "../../config/webapp.js";
import {
  buildMainMenuKeyboard,
  buildHomeOnlyKeyboard,
  buildKnowledgeMenuKeyboard,
  buildTasksMenuKeyboard,
  buildFinanceMenuKeyboard,
  buildMemoryMenuKeyboard,
} from "../keyboards/mainMenu.js";
import { getAllKnowledge } from "../../services/storage/knowledgeService.js";
import { getActiveTasks, getCompletedTasks } from "../../services/storage/taskService.js";
import { getBalance, getHistory, getStatistics } from "../../services/finance/financeService.js";

// Every section is read-only: it only calls the SAME existing service
// functions the typed commands already use (getAllKnowledge,
// getActiveTasks/getCompletedTasks, getBalance/getHistory/getStatistics)
// — no Finance/Memory/Knowledge/Task business logic changes here, this
// module only formats and sends messages.
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

const BALANCE_FLAGS = { VND: "🇻🇳", USD: "🇺🇸", KZT: "🇰🇿", RUB: "🇷🇺", EUR: "🇪🇺" };

function formatBalanceBlock(balances) {
  if (!Object.keys(balances).length) return null;

  let message = "💰 Баланс\n\n";

  for (const [currency, data] of Object.entries(balances)) {
    message += `${BALANCE_FLAGS[currency] || "💵"} ${currency}\n`;
    message += `Доход: ${Number(data.income).toLocaleString()}\n`;
    message += `Расход: ${Number(data.expense).toLocaleString()}\n`;
    message += `Остаток: ${Number(data.balance).toLocaleString()}\n\n`;
  }

  return message.trimEnd();
}

function formatHistoryBlock(history, title = "📒 Последние операции") {
  if (!history.length) return null;

  let message = `${title}\n\n`;

  history.forEach((item, index) => {
    const emoji = item.type === "income" ? "💰" : "💸";

    message += `${index + 1}. ${emoji} ${Number(item.amount).toLocaleString()} ${item.currency || "VND"}`;

    if (item.category) message += ` • ${item.category}`;
    if (item.description) message += ` — ${item.description}`;

    message += "\n";
  });

  return message.trimEnd();
}

function formatStatisticsBlock(stats) {
  if (!stats || stats.transactions === 0) return null;

  let message = "📊 Статистика\n\n";
  message += `📒 Операций: ${stats.transactions}\n\n`;
  message += "📈 Доходы\n";

  for (const [currency, amount] of Object.entries(stats.incomes)) {
    message += `• ${currency}: ${Number(amount).toLocaleString()}\n`;
  }

  message += "\n📉 Расходы\n";

  for (const [currency, amount] of Object.entries(stats.expenses)) {
    message += `• ${currency}: ${Number(amount).toLocaleString()}\n`;
  }

  if (stats.biggestExpense) {
    message += `\n\n━━━━━━━━━━━━━━\n\n🏆 Самая большая покупка\n\n${stats.biggestExpense.description || "Без описания"}\n\n${Number(stats.biggestExpense.amount).toLocaleString()} ${stats.biggestExpense.currency}`;
  }

  return message;
}

function formatKnowledgeListBlock(knowledge, title) {
  if (!knowledge.length) return null;

  let message = `${title}\n\n`;

  knowledge.forEach((item, index) => {
    message += `${index + 1}. ${item.title}\n`;
  });

  return message.trimEnd();
}

function formatTaskListBlock(tasks, title) {
  if (!tasks.length) return null;

  let message = `${title}\n\n`;

  tasks.forEach((task, index) => {
    message += `${index + 1}. ${task.content}\n`;
  });

  return message.trimEnd();
}

export async function sendMainMenu(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildMainMenuKeyboard();
  await sendMessageFn(chatId, "👋 ALMAS готов. Выбери раздел:", { reply_markup });
}

export async function sendFallback(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildMainMenuKeyboard();
  await sendMessageFn(chatId, "Не понял запрос. Выбери раздел в меню 👇", { reply_markup });
}

export async function sendKnowledgeMenu(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, getAllKnowledgeFn = getAllKnowledge } = options;
  const { reply_markup } = buildKnowledgeMenuKeyboard();

  const knowledge = await getAllKnowledgeFn();
  const latest = knowledge.slice(0, 5);

  const message =
    formatKnowledgeListBlock(latest, `📚 Знания (последние ${latest.length})`) ||
    "📚 База знаний пока пуста.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendKnowledgeAll(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, getAllKnowledgeFn = getAllKnowledge } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();

  const knowledge = await getAllKnowledgeFn();

  const message =
    formatKnowledgeListBlock(knowledge, `📚 Всего знаний: ${knowledge.length}`) ||
    "📚 База знаний пока пуста.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendKnowledgeSearchInstruction(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();
  await sendMessageFn(chatId, "🔎 Напиши: найди <запрос>", { reply_markup });
}

export async function sendTasksMenu(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, getActiveTasksFn = getActiveTasks } = options;
  const { reply_markup } = buildTasksMenuKeyboard();

  const tasks = await getActiveTasksFn();
  const latest = tasks.slice(0, 5);

  const message =
    formatTaskListBlock(latest, `📋 Задачи (последние ${latest.length})`) ||
    "📋 У тебя пока нет активных задач.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendCompletedTasksList(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, getCompletedTasksFn = getCompletedTasks } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();

  const tasks = await getCompletedTasksFn();

  const message = formatTaskListBlock(tasks, "✅ Выполненные задачи") || "✅ Пока нет выполненных задач.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendFinanceMenu(chatId, userId, options = {}) {
  const {
    sendMessageFn = defaultSendMessageFn,
    getBalanceFn = getBalance,
    getHistoryFn = getHistory,
  } = options;
  const { reply_markup } = buildFinanceMenuKeyboard();

  const balances = await getBalanceFn(userId);
  const history = await getHistoryFn(userId, 5);

  const balanceBlock = formatBalanceBlock(balances);
  const historyBlock = formatHistoryBlock(history, "📒 Последние операции");

  const message =
    [balanceBlock, historyBlock].filter(Boolean).join("\n\n━━━━━━━━━━━━━━\n\n") ||
    "История пока пустая.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendFinanceHistory(chatId, userId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, getHistoryFn = getHistory } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();

  const history = await getHistoryFn(userId);

  const message = formatHistoryBlock(history) || "История пока пустая.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendFinanceStatistics(chatId, userId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, getStatisticsFn = getStatistics } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();

  const stats = await getStatisticsFn(userId);

  const message = formatStatisticsBlock(stats) || "История пока пустая.";

  await sendMessageFn(chatId, message, { reply_markup });
}

export async function sendMemoryMenu(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildMemoryMenuKeyboard();

  const message =
    "🧠 Память\n\n" +
    "ALMAS запоминает заметки, идеи и важные фразы, которые ты присылаешь. " +
    "Используй кнопки ниже, чтобы вспомнить или найти что-то в памяти.";

  await sendMessageFn(chatId, message, { reply_markup });
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

export async function sendIdeasPlaceholder(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  await sendMessageFn(chatId, "💡 Идеи — раздел готовится.");
}

export async function sendProjectsPlaceholder(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  await sendMessageFn(chatId, "🚀 Проекты — раздел готовится.");
}

export async function sendOpenAlmas(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn, webAppUrl = ALMAS_WEB_APP_URL } = options;

  const message = webAppUrl
    ? "🌐 ALMAS доступен через кнопку меню."
    : "Веб-интерфейс пока не подключён.";

  await sendMessageFn(chatId, message);
}

export async function sendHelp(chatId, options = {}) {
  const { sendMessageFn = defaultSendMessageFn } = options;
  const { reply_markup } = buildHomeOnlyKeyboard();

  const message = `Пока я умею:

👋 Привет

💸 Финансы
• расход 100 кофе
• доход 5000 зарплата
• баланс
• история
• статистика
• расходы за сегодня
• расходы за неделю
• расходы за месяц

📚 Знания
• мои знания
• открыть 1
• спроси ...
• найди ...

🧠 Память
• вспомни ...

📋 Задачи
• мои задачи
• выполнено 1
• выполненные задачи

🎥 Анализ YouTube

🗑 Удалить все знания`;

  await sendMessageFn(chatId, message, { reply_markup });
}
