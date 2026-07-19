import bot from "../config/bot.js";
import { parseFinanceMessage } from "../services/finance/financeParser.js";

import {
  addExpense,
  addIncome,
  getBalance,
  getHistory,
  getStatistics,
  getCategoryExpenses,
  getExpensesByPeriod,
  getFinanceAnalytics,
} from "../services/finance/financeService.js";
import { parseFinanceMessages } from "../services/finance/financeMultiParser.js";
import { parseFinanceQuery } from "../services/finance/financeQueryParser.js";
import crypto from "crypto";
import { detectCategory } from "../services/finance/categorizer.js";
import { handleFinanceQuery } from "./routes/financeRoute.js";
import { isYouTubeLink } from "../services/content/youtubeService.js";

import {
  getAllKnowledge,
  getKnowledgeByIndex,
} from "../services/storage/knowledgeService.js";

import { searchKnowledge } from "../services/search/knowledgeSearchService.js";
import { askKnowledge } from "../services/chat/chatService.js";

import { deleteAllJson } from "../providers/storage/jsonDriver.js";

import { handleYouTube } from "./routes/youtubeRoute.js";

import {
  saveMemory,
  searchMemories,
} from "../services/storage/memoryService.js";

import { classifyMemory } from "../services/storage/memoryClassifier.js";
import { shouldSaveMemory } from "../services/storage/memoryFilter.js";

import {
  getActiveTasks,
  getCompletedTasks,
} from "../services/storage/taskService.js";

import { completeTask } from "../services/storage/taskUpdateService.js";

export function registerMessageHandler() {
  bot.on("message", async (msg) => {

    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text) return;

    const financeQuery = parseFinanceQuery(text);

    console.log("QUERY:", financeQuery);

    if (financeQuery?.intent) {
      const handled = await handleFinanceQuery(
        chatId,
        String(msg.from.id),
        financeQuery
      );

      if (handled) return;
    }

    const finance = parseFinanceMessage(text);
    const finances = parseFinanceMessages(text);
    const batchId = crypto.randomUUID();
    console.log("FINANCES:", finances);
    console.log("COUNT:", finances.length);
    console.log("TEXT:", text);
    console.log("FINANCE:", finance);
    if (finances.length > 1) {

      console.log(">>> MULTI MODE");
      let total = 0;
      let message = "💸 Расходы сохранены\n\n";
      for (const finance of finances) {
    
        console.log("Saving:", finance);
        total += finance.amount;
        message += `• ${finance.description} — ${finance.amount.toLocaleString()} ${finance.currency}\n`;
    
        if (finance.type === "expense") {
    
          const category = detectCategory(finance.description);
    
          await addExpense({
            amount: finance.amount,
            currency: finance.currency,
            category,
            description: finance.description,
            user_id: String(msg.from.id),
            batch_id: batchId,
          });
    
        } else if (finance.type === "income") {
    
          await addIncome({
            amount: finance.amount,
            currency: finance.currency,
            category: "Доход",
            description: finance.description,
            user_id: String(msg.from.id),
            batch_id: batchId,
          });
    
        }
      }
    
      console.log(">>> FINISHED");
    
      message += `\n━━━━━━━━━━━━━━\n💰 Итого: ${total.toLocaleString()} VND`;

      await bot.sendMessage(chatId, message);
    
      return;
    }
    if (finance) {
      if (finance.type === "expense") {
        const category = detectCategory(finance.description);
    
        await addExpense({
          amount: finance.amount,
          currency: finance.currency,
          category,
          description: finance.description,
          user_id: String(msg.from.id),
        });
    
        await bot.sendMessage(
          chatId,
          `💸 Расход сохранён
    
    Сумма: ${finance.amount.toLocaleString()} ${finance.currency}
    Описание: ${finance.description || "Без описания"}`
        );
    
        return;
      }
    
      if (finance.type === "income") {
        await addIncome({
          amount: finance.amount,
          currency: finance.currency,
          category: "Доход",
          description: finance.description,
          user_id: String(msg.from.id),
        });
    
        await bot.sendMessage(
          chatId,
          `💰 Доход сохранён
    
    Сумма: ${finance.amount.toLocaleString()} ${finance.currency}
    Описание: ${finance.description || "Без описания"}`
        );
    
        return;
      }
    }
    
    if (shouldSaveMemory(text)) {
      const memory = classifyMemory(text);
    
      await saveMemory({
        source: "telegram",
        type: "message",
        content: text,
        metadata: {
          memoryType: memory.memoryType,
          importance: memory.importance,
          status: memory.status,
          tags: memory.tags,
          chatId,
          userId: msg.from.id,
          username: msg.from.username ?? null,
          firstName: msg.from.first_name ?? null,
        },
      });
    }
    
    // Приветствие
    if (text === "Привет") {
      await bot.sendMessage(chatId, "Привет, Алмас! 👋");
      return;
    }
    
    // Удалить все знания
    if (text.toLowerCase() === "удалить все знания") {
      const deleted = await deleteAllJson();
    
      await bot.sendMessage(
        chatId,
        `🗑 Удалено: ${deleted} знаний.`
      );
    
      return;
    }
    // AI Chat
if (text.toLowerCase().startsWith("спроси ")) {

  const question = text.slice(8).trim();

  if (!question) {
    await bot.sendMessage(chatId, "❌ Напиши вопрос.");
    return;
  }

  await bot.sendMessage(chatId, "🧠 Думаю...");

  const knowledge = await searchKnowledge(question);

  if (knowledge.length === 0) {
    await bot.sendMessage(
      chatId,
      "📚 В моей базе знаний пока нет подходящей информации."
    );
    return;
  }

  const answer = await askKnowledge(question, knowledge);

  if (!answer) {
    await bot.sendMessage(
      chatId,
      "❌ Не удалось получить ответ."
    );
    return;
  }

  const sources = (answer.sources ?? [])
    .map(source => `• ${source}`)
    .join("\n");

  await bot.sendMessage(
    chatId,
`🧠 Ответ

${answer.answer}

━━━━━━━━━━━━━━

📚 Источники

${sources || "Нет"}`
  );

  return;
}

// Мои знания
if (text.toLowerCase() === "мои знания") {

  const knowledge = await getAllKnowledge();

  if (knowledge.length === 0) {
    await bot.sendMessage(chatId, "📚 База знаний пока пуста.");
    return;
  }

  let message = `📚 Всего знаний: ${knowledge.length}\n\n`;

  knowledge.forEach((item, index) => {
    message += `${index + 1}. ${item.title}\n`;
  });

  await bot.sendMessage(chatId, message);

  return;
}

// Открыть знание
if (
  text.toLowerCase().startsWith("открыть ") ||
  text.toLowerCase().startsWith("покажи ")
) {

  const index = Number(text.split(" ")[1]);

  if (Number.isNaN(index)) {
    await bot.sendMessage(chatId, "❌ Укажи номер знания.");
    return;
  }

  const knowledge = await getKnowledgeByIndex(index);

  if (!knowledge) {
    await bot.sendMessage(chatId, "❌ Знание не найдено.");
    return;
  }

  const keyPoints = knowledge.keyPoints
    .map(item => `• ${item}`)
    .join("\n");

  const ideas = (knowledge.ideas ?? []).length
    ? knowledge.ideas.map(item => `• ${item}`).join("\n")
    : "Нет";

  const tasks = (knowledge.tasks ?? []).length
    ? knowledge.tasks.map(item => `• ${item}`).join("\n")
    : "Нет";

  const tags = (knowledge.tags ?? []).length
    ? knowledge.tags.map(tag => `#${tag}`).join(" ")
    : "Нет";

  await bot.sendMessage(
    chatId,
`📚 ${knowledge.title}

━━━━━━━━━━━━━━

📝 ${knowledge.summary}

━━━━━━━━━━━━━━

💡 Основные мысли

${keyPoints}

━━━━━━━━━━━━━━

🏷️ Теги

${tags}

━━━━━━━━━━━━━━

🚀 Идеи

${ideas}

━━━━━━━━━━━━━━

✅ Задачи

${tasks}`
  );

  return;
}

// Универсальный поиск
if (
  text.toLowerCase().startsWith("найди ") ||
  text.toLowerCase().startsWith("найти ")
) {
  const query = text.split(" ").slice(1).join(" ").trim();

  if (!query) {
    await bot.sendMessage(chatId, "❌ Что нужно найти?");
    return;
  }

  await bot.sendMessage(chatId, `🔎 Ищу "${query}"...`);

  const memories = await searchMemories(query);
  const knowledge = await searchKnowledge(query);

  let message = "";

  if (memories.length > 0) {
    message += "🧠 Память\n\n";

    memories.forEach((memory, index) => {
      const similarity =
        memory.similarity != null
          ? ` (${Math.round(memory.similarity * 100)}%)`
          : "";

      message += `${index + 1}. ${memory.content}${similarity}\n`;
    });

    message += "\n━━━━━━━━━━━━━━\n\n";
  }

  if (knowledge.length > 0) {
    message += "📚 База знаний\n\n";

    knowledge.forEach((item) => {
      message += `📚 ${item.title}\n`;
      message += `👤 ${item.source.author}\n`;
      message += `${item.summary}\n\n`;
    });
  }

  if (!message) {
    message = "❌ Ничего не найдено.";
  }

  await bot.sendMessage(chatId, message);

  return;
}
// Память
if (text.toLowerCase().startsWith("вспомни ")) {

  const query = text.slice(8).trim();

  if (!query) {
    await bot.sendMessage(chatId, "❌ Что нужно вспомнить?");
    return;
  }

  const memories = await searchMemories(query);

  if (memories.length === 0) {
    await bot.sendMessage(
      chatId,
      `🧠 Ничего не найдено по запросу "${query}".`
    );
    return;
  }

  let message = `🧠 Нашёл ${memories.length} записей\n\n`;

  for (const memory of memories) {
    message += `• ${memory.content}\n`;
  }

  await bot.sendMessage(chatId, message);

  return;
}

// Мои задачи
if (text.toLowerCase() === "мои задачи") {

  const tasks = await getActiveTasks();

  if (tasks.length === 0) {
    await bot.sendMessage(chatId, "📋 У тебя пока нет активных задач.");
    return;
  }

  let message = "📋 Активные задачи\n\n";

  tasks.forEach((task, index) => {
    message += `${index + 1}. ${task.content}\n`;
  });

  await bot.sendMessage(chatId, message);

  return;
}

// Выполнить задачу
if (text.toLowerCase().startsWith("выполнено ")) {

  const index = Number(text.split(" ")[1]);

  if (Number.isNaN(index)) {
    await bot.sendMessage(chatId, "❌ Укажи номер задачи.");
    return;
  }

  const task = await completeTask(index);

  if (!task) {
    await bot.sendMessage(chatId, "❌ Задача не найдена.");
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ Выполнено

${task.content}`
  );

  return;
}

// Выполненные задачи
if (text.toLowerCase() === "выполненные задачи") {

  const tasks = await getCompletedTasks();

  if (tasks.length === 0) {
    await bot.sendMessage(chatId, "✅ Пока нет выполненных задач.");
    return;
  }

  let message = "✅ Выполненные задачи\n\n";

  tasks.forEach((task, index) => {
    message += `${index + 1}. ${task.content}\n`;
  });

  await bot.sendMessage(chatId, message);

  return;
}

// Баланс
if (text.toLowerCase() === "баланс") {

  const balances = await getBalance(String(msg.from.id));

  if (!Object.keys(balances).length) {
    await bot.sendMessage(chatId, "История пока пустая.");
    return;
  }

  const flags = {
    VND: "🇻🇳",
    USD: "🇺🇸",
    KZT: "🇰🇿",
    RUB: "🇷🇺",
    EUR: "🇪🇺",
  };

  let message = "💰 Баланс\n\n";

  for (const [currency, data] of Object.entries(balances)) {

    message += `${flags[currency] || "💵"} ${currency}\n`;
    message += `Доход: ${Number(data.income).toLocaleString()}\n`;
    message += `Расход: ${Number(data.expense).toLocaleString()}\n`;
    message += `Остаток: ${Number(data.balance).toLocaleString()}\n\n`;
  }

  await bot.sendMessage(chatId, message);

  return;
}

// История
if (text.toLowerCase() === "история") {

  const history = await getHistory(String(msg.from.id));

  if (!history.length) {
    await bot.sendMessage(chatId, "История пока пустая.");
    return;
  }

  let message = "📒 Последние операции\n\n";

  history.forEach((item, index) => {
    const emoji = item.type === "income" ? "💰" : "💸";

    message += `${index + 1}. ${emoji} ${Number(item.amount).toLocaleString()} ${item.currency || "VND"}`;

    if (item.category) {
      message += ` • ${item.category}`;
    }

    if (item.description) {
      message += ` — ${item.description}`;
    }

    message += "\n";
  });

  await bot.sendMessage(chatId, message);

  return;
}

// Статистика
if (text.toLowerCase() === "статистика") {

  const stats = await getStatistics(String(msg.from.id));

  if (!stats || stats.transactions === 0) {
    await bot.sendMessage(chatId, "История пока пустая.");
    return;
  }

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
    message += `

━━━━━━━━━━━━━━

🏆 Самая большая покупка

${stats.biggestExpense.description || "Без описания"}

${Number(stats.biggestExpense.amount).toLocaleString()} ${stats.biggestExpense.currency}`;
  }

  await bot.sendMessage(chatId, message);

  return;
}

// Сколько потратил на...
if (text.toLowerCase().startsWith("сколько потратил на ")) {

  const categoryInput = text
    .slice("сколько потратил на ".length)
    .trim()
    .toLowerCase();

  const categoryMap = {
    "кафе": "Кафе",
    "продукты": "Продукты",
    "транспорт": "Транспорт",
    "развлечения": "Развлечения",
    "здоровье": "Здоровье",
    "одежда": "Одежда",
    "другое": "Другое",
  };

  const category = categoryMap[categoryInput];

  if (!category) {
    await bot.sendMessage(chatId, "❌ Неизвестная категория.");
    return;
  }

  const expenses = await getCategoryExpenses(
    String(msg.from.id),
    category
  );

  if (!Object.keys(expenses).length) {
    await bot.sendMessage(
      chatId,
      `По категории "${category}" расходов пока нет.`
    );
    return;
  }

  let message = `📊 ${category}\n\n`;

  for (const [currency, amount] of Object.entries(expenses)) {
    message += `💸 ${Number(amount).toLocaleString()} ${currency}\n`;
  }

  await bot.sendMessage(chatId, message);

  return;
}

// Расходы за период
if (
  text.toLowerCase() === "расходы за сегодня" ||
  text.toLowerCase() === "расходы за неделю" ||
  text.toLowerCase() === "расходы за месяц"
) {

  let days = 30;
  let title = "месяц";

  if (text.toLowerCase() === "расходы за сегодня") {
    days = 1;
    title = "сегодня";
  }

  if (text.toLowerCase() === "расходы за неделю") {
    days = 7;
    title = "неделю";
  }

  const totals = await getExpensesByPeriod(
    String(msg.from.id),
    days
  );

  if (!Object.keys(totals).length) {
    await bot.sendMessage(chatId, "За этот период расходов нет.");
    return;
  }

  let message = `📅 Расходы за ${title}\n\n`;

  for (const [currency, amount] of Object.entries(totals)) {
    message += `💸 ${Number(amount).toLocaleString()} ${currency}\n`;
  }

  await bot.sendMessage(chatId, message);

  return;
}
    // YouTube
if (isYouTubeLink(text)) {
  await handleYouTube(chatId, text);
  return;
}

// Если команда не распознана
await bot.sendMessage(
  chatId,
`Пока я умею:

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

🗑 Удалить все знания`
);

  });
}