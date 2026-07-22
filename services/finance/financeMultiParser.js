import { parseFinanceMessage } from "./financeParser.js";
import {
  detectExplicitCurrency,
  normalizeGroupedDigits,
} from "./financeTextNormalize.js";

const AMOUNT_TOKEN_RE =
  /(\d+(?:[.,]\d+)?)(?:\s*(тысячи|тысяч|тыс|миллионов|миллиона|миллион|млн)(?![a-zа-яё])|\s*([kкм])(?![a-zа-яё]))?/giu;

const CURRENCY_AFTER_RE =
  /^\s*(vnd|usd|eur|rub|kzt|донг(?:ов|а)?|доллар(?:ов|а)?|тенге|руб(?:лей|ля)?|евро|₫|₸|\$|€|₽)/i;

/**
 * True when a numeric match is a standalone finance amount, not a
 * version / model number inside a description (Node 22, GPT-4, iPhone 16).
 */
export function isFinanceAmountMatch(match, fullText, isFirst) {
  if (!match) return false;
  const amountValue = Number(String(match[1] || "").replace(",", "."));
  // Never treat bare 0 / leading-zero groups as finance amounts.
  if (!Number.isFinite(amountValue) || amountValue <= 0) return false;
  if (isFirst) return true;

  const suffix = String(match[2] || match[3] || "").trim();
  if (suffix) return true;

  const start = match.index ?? 0;
  const end = start + String(match[0] || "").length;
  const after = fullText.slice(end, end + 24);
  if (CURRENCY_AFTER_RE.test(after)) {
    return true;
  }
  // "на кофе" / "на такси" after amount → money amount.
  if (/^\s*на\s+[a-zа-яё]/iu.test(after)) {
    return true;
  }

  const before = fullText.slice(0, start);
  const prevAmount = [...before.matchAll(AMOUNT_TOKEN_RE)].pop();
  const prevEnd = prevAmount
    ? (prevAmount.index || 0) + prevAmount[0].length
    : 0;
  const between = fullText.slice(prevEnd, start);

  // List connectors: "..., 25", "... и 300", "... потом 25"
  if (
    /^[\s,;]*и?[\s,;]*$/iu.test(between) ||
    /^[\s,;]*(?:потом|затем|и)[\s,;]*$/iu.test(between) ||
    /(?:^|[\s,;])(?:потом|затем|и)\s*$/iu.test(between.trim())
  ) {
    return true;
  }

  // Description then list: "на колу и 300000"
  if (/\b(?:и|потом|затем)\s*$/iu.test(between.trim())) {
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

function trimListNoise(description) {
  return String(description || "")
    .replace(/^(?:потом|затем|и)\s+/iu, "")
    .replace(/^и$/i, "")
    .replace(/^,\s*/i, "")
    .replace(/\s+и\s*$/iu, "")
    .trim();
}

function parseAmountListAsOperations(text, matches, inheritedCurrency = null) {
  const operations = [];
  const firstAmount = matches[0];
  const action = text.slice(0, firstAmount.index).trim();
  let lastCurrency =
    inheritedCurrency || detectExplicitCurrency(text) || null;

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const amountText = current[0];
    const start = current.index + amountText.length;
    const end = next ? next.index : text.length;

    let description = trimListNoise(text.slice(start, end));
    // Drop trailing list glue that belongs to the next amount ("… и").
    description = description.replace(/\s+и\s*$/iu, "").trim();

    const clause = `${amountText} ${description}`.trim();
    let parsed =
      parseFinanceMessage(`${action} ${clause}`.trim()) ||
      parseBareOrPrefixedFinance(clause);

    if (!parsed) continue;

    const explicit =
      detectExplicitCurrency(clause) || detectExplicitCurrency(text);
    if (explicit) {
      parsed = { ...parsed, currency: explicit };
      lastCurrency = explicit;
    } else if (lastCurrency) {
      parsed = { ...parsed, currency: lastCurrency };
    }

    operations.push(parsed);
  }

  return operations;
}

function applyCurrencyInheritance(operations, fullText) {
  if (!operations.length) return operations;
  const textCurrency = detectExplicitCurrency(fullText);
  let last = textCurrency || operations[0].currency || "VND";
  return operations.map((op, index) => {
    const explicitInOp = detectExplicitCurrency(
      `${op.description || ""} ${op.amount} ${op.currency || ""}`
    );
    if (index === 0 && textCurrency) {
      last = textCurrency;
      return { ...op, currency: textCurrency };
    }
    if (explicitInOp && explicitInOp !== "VND") {
      // Prefer non-default only when explicitly present in this op text;
      // VND words may appear only once at sentence start.
      last = explicitInOp;
      return { ...op, currency: explicitInOp };
    }
    const local = detectExplicitCurrency(String(op.description || ""));
    if (local) {
      last = local;
      return { ...op, currency: local };
    }
    return { ...op, currency: last || op.currency || "VND" };
  });
}

/**
 * Parse one or more finance operations from a message.
 * Never treats description numbers (Node 22, GPT-4, …) as extra expenses.
 */
export function parseFinanceMessages(text = "") {
  if (!text) return [];

  const original = normalizeGroupedDigits(text.trim());
  const lines = original
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    const operations = [];
    let inherited = detectExplicitCurrency(original);
    for (const line of lines) {
      const nested = collectFinanceAmountMatches(line);
      if (nested.length > 1) {
        const ops = parseAmountListAsOperations(line, nested, inherited);
        operations.push(...ops);
        if (ops.length) inherited = ops[ops.length - 1].currency;
        continue;
      }
      let parsed = parseFinanceMessage(line);
      if (!parsed) parsed = parseBareOrPrefixedFinance(line);
      if (parsed) {
        if (!detectExplicitCurrency(line) && inherited) {
          parsed = { ...parsed, currency: inherited };
        }
        inherited = parsed.currency;
        operations.push(parsed);
      }
    }
    if (operations.length > 1) {
      return applyCurrencyInheritance(operations, original);
    }
  }

  // Prefer whole-text multi-amount parse (best for spoken lists).
  const allMatches = collectFinanceAmountMatches(original);
  if (allMatches.length > 1) {
    return applyCurrencyInheritance(
      parseAmountListAsOperations(
        original,
        allMatches,
        detectExplicitCurrency(original)
      ),
      original
    );
  }

  // Comma / "потом" list parts when whole-text multi-amount did not apply.
  const softParts = original
    .split(/,|(?=\bпотом\b)|(?=\bзатем\b)/iu)
    .map((p) => p.trim())
    .filter(Boolean);

  if (softParts.length > 1 && allMatches.length <= 1) {
    const operations = [];
    let inherited = detectExplicitCurrency(original);
    for (const part of softParts) {
      const kept = collectFinanceAmountMatches(part);
      if (kept.length > 1) {
        const ops = parseAmountListAsOperations(part, kept, inherited);
        operations.push(...ops);
        if (ops.length) inherited = ops[ops.length - 1].currency;
        continue;
      }
      let parsed = parseFinanceMessage(part);
      if (!parsed) parsed = parseBareOrPrefixedFinance(part);
      if (parsed) {
        if (!detectExplicitCurrency(part) && inherited) {
          parsed = { ...parsed, currency: inherited };
        }
        inherited = parsed.currency;
        operations.push(parsed);
      }
    }
    if (operations.length > 1) {
      return applyCurrencyInheritance(operations, original);
    }
  }

  return [];
}

function parseBareOrPrefixedFinance(part) {
  let parsed = parseFinanceMessage(part);
  if (parsed) return parsed;
  parsed = parseFinanceMessage(`Потратил ${part}`);
  return parsed;
}
