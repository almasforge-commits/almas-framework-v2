import bot from "../../config/bot.js";

import {
  getBalance,
  getHistory,
  getStatistics,
  getCategoryExpenses,
  getExpensesByPeriod,
  getFinanceAnalytics,
  deleteLastTransaction,
} from "../../services/finance/financeService.js";

export async function handleFinanceQuery(chatId, userId, query) {

  if (query.intent === "delete_last") {

    const transactions = await deleteLastTransaction(userId);
  
    if (!transactions || transactions.length === 0) {
      await bot.sendMessage(chatId, "История пуста.");
      return true;
    }
  
    let total = 0;
    let message = "🗑 Последняя группа расходов удалена\n\n";
  
    for (const transaction of transactions) {
  
      const icon = transaction.type === "income" ? "🟢" : "🔴";
  
      message += `• ${icon} ${transaction.description} — ${Number(transaction.amount).toLocaleString()} ${transaction.currency}\n`;
  
      total += Number(transaction.amount);
    }
  
    const currency = transactions[0].currency || "";
  
    message += `\n━━━━━━━━━━━━━━\n💰 Всего удалено: ${total.toLocaleString()} ${currency}`;
  
    await bot.sendMessage(chatId, message);
  
    return true;
  }

  // Баланс
  if (query.intent === "balance") {

    const balances = await getBalance(userId);

    if (!Object.keys(balances).length) {
      await bot.sendMessage(chatId, "История пока пустая.");
      return true;
    }

    const flags = {
      VND: "🇻🇳",
      USD: "🇺🇸",
      RUB: "🇷🇺",
      KZT: "🇰🇿",
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
    return true;
  }

  // Общая статистика
  if (query.intent === "statistics") {

    const stats = await getStatistics(userId);

    if (!stats) {
      await bot.sendMessage(chatId, "История пуста.");
      return true;
    }

    let message = "📊 Статистика\n\n";

    message += `Операций: ${stats.transactions}\n\n`;

    message += "📉 Расходы\n";

    for (const [currency, value] of Object.entries(stats.expenses)) {
      message += `${currency}: ${Number(value).toLocaleString()}\n`;
    }

    message += "\n📈 Доходы\n";

    for (const [currency, value] of Object.entries(stats.incomes)) {
      message += `${currency}: ${Number(value).toLocaleString()}\n`;
    }

    await bot.sendMessage(chatId, message);
    return true;
  }

  // Расходы по категории
  if (query.intent === "expenses" && query.category) {

    const result = await getCategoryExpenses(userId, query.category);

    if (!Object.keys(result).length) {
      await bot.sendMessage(chatId, "Расходов не найдено.");
      return true;
    }

    let message = `📊 ${query.category}\n\n`;

    for (const [currency, value] of Object.entries(result)) {
      message += `💸 ${Number(value).toLocaleString()} ${currency}\n`;
    }

    await bot.sendMessage(chatId, message);
    return true;
  }

  // Расходы за период
  if (query.intent === "expenses") {

    let days = 36500;

    if (query.period === "today") days = 1;
    if (query.period === "week") days = 7;
    if (query.period === "month") days = 30;

    const result = await getExpensesByPeriod(userId, days);

    if (!Object.keys(result).length) {
      await bot.sendMessage(chatId, "Расходов не найдено.");
      return true;
    }

    let message = "💸 Расходы\n\n";

    for (const [currency, value] of Object.entries(result)) {
      message += `${Number(value).toLocaleString()} ${currency}\n`;
    }

    await bot.sendMessage(chatId, message);
    return true;
  }

// История

if (query.intent === "history") {

  const history = await getHistory(userId, 10);

  if (!history.length) {
    await bot.sendMessage(chatId, "История пока пуста.");
    return true;
  }

  let message = "📒 Последние операции\n\n";

  for (const item of history) {

    const icon =
      item.type === "income"
        ? "🟢"
        : "🔴";

    message += `${icon} ${Number(item.amount).toLocaleString()} ${item.currency}`;

    if (item.description) {
      message += ` — ${item.description}`;
    }

    message += "\n";
  }

  await bot.sendMessage(chatId, message);

  return true;
}

  // Аналитика
  if (query.intent === "analytics") {

    const analytics = await getFinanceAnalytics(userId);

    if (!analytics) {
      await bot.sendMessage(chatId, "История пуста.");
      return true;
    }

    let message = "📊 Анализ расходов\n\n";

    message += "💰 По валютам\n";

    for (const [currency, value] of Object.entries(analytics.currencies)) {
      message += `• ${currency}: ${Number(value).toLocaleString()}\n`;
    }

    message += "\n📂 По категориям\n";

    for (const [category, values] of Object.entries(analytics.categories)) {

      message += `\n${category}\n`;

      for (const [currency, value] of Object.entries(values)) {
        message += `  • ${Number(value).toLocaleString()} ${currency}\n`;
      }

    }

    if (analytics.biggest) {

      message += `

━━━━━━━━━━━━━━

🏆 Самая крупная покупка

${analytics.biggest.description || "Без описания"}

${Number(analytics.biggest.amount).toLocaleString()} ${analytics.biggest.currency}`;
    }

    await bot.sendMessage(chatId, message);
    return true;
  }

  return false;
}