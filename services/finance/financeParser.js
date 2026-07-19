import { detectCategory } from "./categorizer.js";
const EXPENSE_WORDS = [
    "расход",
    "расходы",
  
    "купил",
    "купила",
    "покупка",
    "приобрел",
    "приобрёл",
    "приобрела",
  
    "потратил",
    "потратила",
    "тратил",
    "трата",
  
    "заплатил",
    "заплатила",
    "оплатил",
    "оплатила",
  
    "отдал",
    "отдала",
  
    "снял",
    "сняла",
  
    "перевел",
    "перевёл",
    "перевела",
  
    "инвестировал",
    "инвестировала",
    "вложил",
    "вложила",
  
    "донат",
    "пожертвовал",
    "пожертвовала"
  ];
  
  const INCOME_WORDS = [
    "доход",
    "доходы",
  
    "получил",
    "получила",
    "получено",
    "получена",
  
    "заработал",
    "заработала",
  
    "подзаработал",
    "подзаработала",
  
    "продал",
    "продала",
    "продано",
  
    "заработок",
  
    "аванс",
    "зарплата",
    "премия",
    "бонус",
  
    "вернули",
    "возврат",
    "возместили",
  
    "пришел перевод",
    "пришёл перевод",
    "получил перевод",
  
    "пришли деньги",
    "получил деньги",
  
    "выиграл",
    "выиграла",
  
    "кэшбэк",
    "кешбек",
    "кэшбек",
  
    "дивиденды",
    "проценты",
  
    "сдал",
    "сдала"
  ];
  const INCOME_KEYWORDS = [
    "зарплата",
    "аванс",
    "премия",
    "бонус",
    "кэшбэк",
    "кешбек",
    "кэшбек",
    "дивиденды",
    "проценты",
    "фриланс",
    "проект",
    "заказ"
  ];
  
  export function parseFinanceMessage(text = "") {
  
    if (!text) return null;
  
    const original = text.trim();
    const lower = original.toLowerCase();
  
    let type = null;
  
    if (EXPENSE_WORDS.some(v => lower.startsWith(v))) {
        type = "expense";
      }
      
      if (INCOME_WORDS.some(v => lower.startsWith(v))) {
        type = "income";
      }
      
      if (!type) {
      
        // Доход по ключевым словам
        if (INCOME_KEYWORDS.some(v => lower.startsWith(v))) {
          type = "income";
        }
      
        // Расход по категории
        else {
          const category = detectCategory(lower);
      
          if (category) {
            type = "expense";
          }
        }
      
      }
      
      if (!type) return null;
  
    const currency = detectCurrency(lower);
  
    const amountMatch = lower.match(
      /(\d+(?:[.,]\d+)?)(?:\s*)(k|m|тыс|тысяч|тысячи|млн|миллион(?:а|ов)?)?/i
    );
  
    if (!amountMatch) return null;
  
    const amount = parseAmount(
      amountMatch[1],
      amountMatch[2]
    );
  
    let description = original;
  
    [...EXPENSE_WORDS, ...INCOME_WORDS].forEach(word => {
      description = description.replace(
        new RegExp(word, "ig"),
        ""
      );
    });
  
    description = description.replace(amountMatch[0], "");
  
    description = description
  .replace(/донг(?:ов|а)?/gi, "")
  .replace(/тенге/gi, "")
  .replace(/доллар(?:ов|а)?/gi, "")
  .replace(/usd|vnd|kzt|rub|eur/gi, "")
  .replace(/[₫₸$€₽]/g, "")
  .replace(/(^|\s+)(за|на|в|во|по)(\s+|$)/gi, " ")
  .replace(/[-–—:,.]/g, "")
  .replace(/\s+/g, " ")
  .trim();
  console.log("DESCRIPTION:", description);
  if (!description) {
    description = "";
  }
    return {
      type,
      amount,
      currency,
      description
    };
  }
  
  function parseAmount(number, suffix = "") {
  
    let value = parseFloat(
      number.replace(",", ".")
    );
  
    suffix = (suffix || "").toLowerCase();
  
    switch (suffix) {
  
      case "k":
        value *= 1000;
        break;
  
      case "m":
        value *= 1000000;
        break;
  
      case "тыс":
      case "тысяч":
      case "тысячи":
        value *= 1000;
        break;
  
      case "млн":
      case "миллион":
      case "миллиона":
      case "миллионов":
        value *= 1000000;
        break;
    }
  
    return Math.round(value);
  }
  
  function detectCurrency(text) {
  
    if (
      /донг|донга|донгов|vnd|₫/i.test(text)
    ) {
      return "VND";
    }
  
    if (
      /тенге|kzt|₸/i.test(text)
    ) {
      return "KZT";
    }
  
    if (
      /usd|доллар|\$/i.test(text)
    ) {
      return "USD";
    }
  
    if (
      /eur|евро|€/i.test(text)
    ) {
      return "EUR";
    }
  
    if (
      /rub|руб|₽/i.test(text)
    ) {
      return "RUB";
    }
  
    return "VND";
  }