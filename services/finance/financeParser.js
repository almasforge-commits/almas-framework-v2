import { detectCategory } from "./categorizer.js";
import { convertSpokenNumbersToDigits } from "./russianNumberParser.js";
import { stripTrailingActionClause } from "../../core/utils/stripTrailingActionClause.js";
import {
  cleanFinanceDescription,
  detectExplicitCurrency,
  normalizeGroupedDigits,
} from "./financeTextNormalize.js";

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

/** Keywords that need an amount nearby — bare "проект …" is not finance. */
const AMBIGUOUS_INCOME_KEYWORDS = new Set(["проект", "заказ", "фриланс"]);

function hasAmountSignal(text) {
  const lower = String(text || "");
  return (
    /(\d+(?:[.,]\d+)?)\s*(тысячи|тысяч|тыс|миллионов|миллиона|миллион|млн|k|к)(?![a-zа-яё])/iu.test(
      lower
    ) ||
    /(\d+(?:[.,]\d+)?)\s*(vnd|usd|eur|rub|kzt|донг|доллар|тенге|руб|евро)/iu.test(
      lower
    ) ||
    /\d{2,}/.test(lower) ||
    (/\b(тысяч|тысячи|тысяча|миллион(?:а|ов)?)\b/iu.test(lower) &&
      /(\d+|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|сто)/iu.test(
        lower
      ))
  );
}

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

  // Space-grouped money first ("75 000" → 75000), then spoken words.
  const grouped = normalizeGroupedDigits(original);
  const convertedOriginal = convertSpokenNumbersToDigits(grouped);
  const lower = convertedOriginal.toLowerCase();

  const type = detectFinanceType(lower);
  if (!type) return null;

  const currency = detectExplicitCurrency(lower) || "VND";

  const amountMatch = lower.match(
    /(\d+(?:[.,]\d+)?)(?:\s*(тысячи|тысяч|тыс|миллионов|миллиона|миллион|млн)(?![a-zа-яё])|\s*([kкм])(?![a-zа-яё]))?/iu
  );

  if (!amountMatch) return null;

  const amount = parseAmount(
    amountMatch[1],
    amountMatch[2] || amountMatch[3] || ""
  );
  if (!Number.isFinite(amount) || amount <= 0) return null;

  let description = convertedOriginal;

  [...EXPENSE_WORDS, ...INCOME_WORDS].forEach((word) => {
    description = description.replace(new RegExp(word, "ig"), "");
  });

  description = description.replace(amountMatch[0], "");
  description = cleanFinanceDescription(description);
  description = stripTrailingActionClause(description);

  if (!description) {
    description = "";
  }

  // Never surface internal type names as descriptions.
  if (/^finance_(expense|income)$/i.test(description)) {
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
    INCOME_WORDS.some((v) => lower.startsWith(v))
  ) {
    return true;
  }

  if (
    INCOME_KEYWORDS.some((v) => {
      if (!lower.startsWith(v)) return false;
      if (AMBIGUOUS_INCOME_KEYWORDS.has(v)) return hasAmountSignal(lower);
      return true;
    })
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
