/**
 * Normalize space-grouped digit amounts used in RU/VN money writing.
 * "75 000" → "75000", "1 234 567" → "1234567"
 * Does not touch isolated numbers like "Node 22" or "GPT-4".
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeGroupedDigits(text) {
  return String(text ?? "").replace(
    /\b(\d{1,3}(?:[\s\u00A0\u202F]\d{3})+)\b/g,
    (match) => match.replace(/[\s\u00A0\u202F]/g, "")
  );
}

/** Cyrillic-safe word edges (JS \\b is ASCII-only). */
const W = "[a-zа-яё]";
const BOUND_L = `(?<!${W})`;
const BOUND_R = `(?!${W})`;

/**
 * Filler / command phrases that must not remain in finance descriptions.
 */
const DESCRIPTION_FILLERS = [
  new RegExp(`${BOUND_L}запиши(?:те)?${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}что\\s+я${BOUND_R}`, "giu"),
  new RegExp(
    `${BOUND_L}я\\s+(?:потратил|потратила|получил|получила|заработал|заработала)${BOUND_R}`,
    "giu"
  ),
  new RegExp(`${BOUND_L}(?:потратил|потратила|получил|получила|заработал|заработала)${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}потом${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}затем${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}сегодня${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}вчера${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}только\\s+что${BOUND_R}`, "giu"),
  new RegExp(`${BOUND_L}что${BOUND_R}`, "giu"),
];

/**
 * Clean finance description after amount/currency/type stripping.
 * @param {string} raw
 * @returns {string}
 */
export function cleanFinanceDescription(raw) {
  let description = String(raw ?? "");

  for (const re of DESCRIPTION_FILLERS) {
    description = description.replace(re, " ");
  }

  description = description
    .replace(new RegExp(`${BOUND_L}донг(?:ов|а)?${BOUND_R}`, "giu"), "")
    .replace(new RegExp(`${BOUND_L}тенге${BOUND_R}`, "giu"), "")
    .replace(new RegExp(`${BOUND_L}доллар(?:ов|а)?${BOUND_R}`, "giu"), "")
    .replace(new RegExp(`${BOUND_L}(?:usd|vnd|kzt|rub|eur)${BOUND_R}`, "giu"), "")
    .replace(/[₫₸$€₽]/g, "")
    .replace(
      new RegExp(
        `^(сегодня|вчера|завтра|утром|вечером|днём|днем|ночью|только что|сейчас|потом|затем|я|что)\\s+`,
        "giu"
      ),
      ""
    )
    .replace(/(^|\s+)(за|на|в|во|по)(\s+|$)/giu, " ")
    .replace(/[-–—:,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Drop leftover command stubs / pronouns.
  description = description
    .replace(/^(что|я|и)\s+/giu, "")
    .replace(/\s+(что|я|и)$/giu, "")
    .replace(/^(сегодня|вчера|потом|затем)\s+/giu, "")
    .trim();

  // Accusative → dictionary form for short common nouns.
  if (/^колу$/iu.test(description)) description = "кола";
  if (/^кофе$/iu.test(description)) description = "кофе";

  return description;
}

/**
 * Detect currency from text; returns null when none explicit.
 * @param {string} text
 * @returns {string|null}
 */
export function detectExplicitCurrency(text) {
  const t = String(text || "");
  if (/донг|донга|донгов|vnd|₫/i.test(t)) return "VND";
  if (/тенге|kzt|₸/i.test(t)) return "KZT";
  if (/usd|доллар|\$/i.test(t)) return "USD";
  if (/eur|евро|€/i.test(t)) return "EUR";
  if (/rub|руб|₽/i.test(t)) return "RUB";
  return null;
}
