import { parseFinanceMessage } from "./financeParser.js";

const AMOUNT_TOKEN_RE =
  /(\d+(?:[.,]\d+)?)(?:\s*(тысячи|тысяч|тыс|миллионов|миллиона|миллион|млн)(?![a-zа-яё])|\s*([kкм])(?![a-zа-яё]))?/giu;

/**
 * True when a numeric match is a standalone finance amount, not a
 * version / model number inside a description (Node 22, GPT-4, iPhone 16).
 */
export function isFinanceAmountMatch(match, fullText, isFirst) {
  if (!match) return false;
  if (isFirst) return true;

  const suffix = String(match[2] || match[3] || "").trim();
  if (suffix) return true;

  const start = match.index ?? 0;
  const end = start + String(match[0] || "").length;
  const after = fullText.slice(end, end + 20);
  if (
    /^\s*(vnd|usd|eur|rub|kzt|донг(?:ов|а)?|доллар(?:ов|а)?|тенге|руб(?:лей|ля)?|евро|₫|₸|\$|€|₽)/i.test(
      after
    )
  ) {
    return true;
  }

  const before = fullText.slice(0, start);
  const prevAmount = [...before.matchAll(AMOUNT_TOKEN_RE)].pop();
  const prevEnd = prevAmount
    ? (prevAmount.index || 0) + prevAmount[0].length
    : 0;
  const between = fullText.slice(prevEnd, start);

  if (/^[\s,;]*и?[\s,;]*$/iu.test(between)) {
    return true;
  }

  if (/[a-zа-яё]{2,}/iu.test(between)) {
    return false;
  }

  return /[,;]/.test(between);
}

function collectFinanceAmountMatches(text) {
  const matches = [];
  for (const match of String(text).matchAll(AMOUNT_TOKEN_RE)) {
    if (isFinanceAmountMatch(match, text, matches.length === 0)) {
      matches.push(match);
    }
  }
  return matches;
}

function parseAmountListAsOperations(text, matches) {
  const operations = [];
  const firstAmount = matches[0];
  const action = text.slice(0, firstAmount.index).trim();

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const amountText = current[0];
    const start = current.index + amountText.length;
    const end = next ? next.index : text.length;

    let description = text.slice(start, end).trim();
    description = description
      .replace(/^и\s+/i, "")
      .replace(/^и$/i, "")
      .replace(/^,\s*/i, "")
      .trim();

    const message = `${action} ${amountText} ${description}`.trim();
    let parsed = parseFinanceMessage(message);
    if (!parsed) parsed = parseBareOrPrefixedFinance(`${amountText} ${description}`);
    if (parsed) operations.push(parsed);
  }

  return operations;
}

/**
 * Parse one or more finance operations from a message.
 * Never treats description numbers (Node 22, GPT-4, …) as extra expenses.
 */
export function parseFinanceMessages(text = "") {
  if (!text) return [];

  const original = text.trim();
  const lines = original
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    const operations = [];
    for (const line of lines) {
      const nested = collectFinanceAmountMatches(line);
      if (nested.length > 1) {
        operations.push(...parseAmountListAsOperations(line, nested));
        continue;
      }
      let parsed = parseFinanceMessage(line);
      if (!parsed) parsed = parseBareOrPrefixedFinance(line);
      if (parsed) operations.push(parsed);
    }
    if (operations.length > 1) return operations;
  }

  const commaParts = original
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (commaParts.length > 1) {
    const operations = [];
    for (const part of commaParts) {
      const kept = collectFinanceAmountMatches(part);
      if (kept.length > 1) {
        operations.push(...parseAmountListAsOperations(part, kept));
        continue;
      }
      let parsed = parseFinanceMessage(part);
      if (!parsed) parsed = parseBareOrPrefixedFinance(part);
      if (parsed) operations.push(parsed);
    }
    if (operations.length > 1) return operations;
  }

  const matches = collectFinanceAmountMatches(original);
  if (matches.length <= 1) {
    return [];
  }

  return parseAmountListAsOperations(original, matches);
}

function parseBareOrPrefixedFinance(part) {
  let parsed = parseFinanceMessage(part);
  if (parsed) return parsed;
  parsed = parseFinanceMessage(`Потратил ${part}`);
  return parsed;
}
