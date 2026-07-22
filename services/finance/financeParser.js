import { detectCategory } from "./categorizer.js";
import { convertSpokenNumbersToDigits } from "./russianNumberParser.js";
import { stripTrailingActionClause } from "../../core/utils/stripTrailingActionClause.js";

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
  "пожертвовала",
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
  "сдала",
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
  "заказ",
];

/** Leading context that must not block finance verb detection. */
const LEADING_CONTEXT_RE =
  /^(сегодня|вчера|завтра|утром|вечером|днём|днем|ночью|только что|сейчас|кстати|слушай|ну)\s+/giu;

/**
 * Strip temporal / filler prefixes so "Сегодня заработал …" still types as income.
 * @param {string} lower
 */
export function stripLeadingFinanceContext(lower) {
  let text = String(lower ?? "").trim();
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(LEADING_CONTEXT_RE, "").trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

function detectFinanceType(lower) {
  const normalized = stripLeadingFinanceContext(lower);

  if (EXPENSE_WORDS.some((v) => normalized.startsWith(v))) {
    return "expense";
  }
  if (INCOME_WORDS.some((v) => normalized.startsWith(v))) {
    return "income";
  }
  if (INCOME_KEYWORDS.some((v) => normalized.startsWith(v))) {
    return "income";
  }

  for (const word of EXPENSE_WORDS) {
    if (
      new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:\\s|$)`, "iu").test(
        normalized
      )
    ) {
      return "expense";
    }
  }
  for (const word of INCOME_WORDS) {
    if (
      new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:\\s|$)`, "iu").test(
        normalized
      )
    ) {
      return "income";
    }
  }

  const category = detectCategory(normalized);
  if (category) return "expense";

  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseFinanceMessage(text = "") {
  if (!text) return null;

  const original = text.trim();

  const convertedOriginal = convertSpokenNumbersToDigits(original);
  const lower = convertedOriginal.toLowerCase();

  const type = detectFinanceType(lower);
  if (!type) return null;

  const currency = detectCurrency(lower);

  const amountMatch = lower.match(
    /(\d+(?:[.,]\d+)?)(?:\s*(тысячи|тысяч|тыс|миллионов|миллиона|миллион|млн)(?![a-zа-яё])|\s*([kкм])(?![a-zа-яё]))?/iu
  );

  if (!amountMatch) return null;

  const amount = parseAmount(
    amountMatch[1],
    amountMatch[2] || amountMatch[3] || ""
  );

  let description = convertedOriginal;

  [...EXPENSE_WORDS, ...INCOME_WORDS].forEach((word) => {
    description = description.replace(new RegExp(word, "ig"), "");
  });

  description = description.replace(amountMatch[0], "");

  description = description
    .replace(/донг(?:ов|а)?/gi, "")
    .replace(/тенге/gi, "")
    .replace(/доллар(?:ов|а)?/gi, "")
    .replace(/usd|vnd|kzt|rub|eur/gi, "")
    .replace(/[₫₸$€₽]/g, "")
    .replace(
      /^(сегодня|вчера|завтра|утром|вечером|днём|днем|ночью|только что|сейчас)\s+/giu,
      ""
    )
    .replace(/(^|\s+)(за|на|в|во|по)(\s+|$)/gi, " ")
    .replace(/[-–—:,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  description = stripTrailingActionClause(description);

  if (!description) {
    description = "";
  }

  return {
    type,
    amount,
    currency,
    description,
  };
}

/**
 * Pure classifier for finance-like attempts (router / capture guards).
 */
export function looksLikeFinanceAttempt(text = "") {
  if (!text) return false;

  const lower = stripLeadingFinanceContext(text.trim().toLowerCase());

  if (
    EXPENSE_WORDS.some((v) => lower.startsWith(v)) ||
    INCOME_WORDS.some((v) => lower.startsWith(v)) ||
    INCOME_KEYWORDS.some((v) => lower.startsWith(v))
  ) {
    return true;
  }

  for (const word of [...EXPENSE_WORDS, ...INCOME_WORDS]) {
    if (
      new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:\\s|$)`, "iu").test(lower)
    ) {
      return true;
    }
  }

  if (
    /(\d+(?:[.,]\d+)?)\s*(тысячи|тысяч|тыс|миллионов|миллиона|миллион|млн|k|к)(?![a-zа-яё])/iu.test(
      lower
    ) ||
    /(\d+(?:[.,]\d+)?)\s*(vnd|usd|eur|rub|kzt|донг|доллар|тенге|руб|евро)/iu.test(
      lower
    )
  ) {
    return true;
  }

  if (
    /\b(тысяч|тысячи|тысяча|миллион(?:а|ов)?)\b/iu.test(lower) &&
    /(\d+|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|сто)/iu.test(
      lower
    )
  ) {
    return true;
  }

  return false;
}

function parseAmount(number, suffix = "") {
  let value = parseFloat(number.replace(",", "."));

  suffix = (suffix || "").toLowerCase();

  switch (suffix) {
    case "k":
    case "к":
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
  if (/донг|донга|донгов|vnd|₫/i.test(text)) {
    return "VND";
  }

  if (/тенге|kzt|₸/i.test(text)) {
    return "KZT";
  }

  if (/usd|доллар|\$/i.test(text)) {
    return "USD";
  }

  if (/eur|евро|€/i.test(text)) {
    return "EUR";
  }

  if (/rub|руб|₽/i.test(text)) {
    return "RUB";
  }

  return "VND";
}
