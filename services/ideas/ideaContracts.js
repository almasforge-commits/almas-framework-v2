/**
 * Ideas Capture contracts — categories, labels, normalization.
 * Pure module: no Telegram / Supabase / OpenAI.
 */

export const IDEA_CATEGORIES = Object.freeze([
  "content",
  "business",
  "project",
  "life",
  "health",
  "sport",
  "learning",
  "observation",
  "travel",
  "finance",
  "other",
]);

/** Categories offered as Telegram correction buttons. */
export const IDEA_CORRECTION_CATEGORIES = Object.freeze([
  "content",
  "business",
  "project",
  "life",
  "other",
]);

export const IDEA_CATEGORY_LABELS_RU = Object.freeze({
  content: "Контент",
  business: "Бизнес",
  project: "Проект",
  life: "Жизнь",
  health: "Здоровье",
  sport: "Спорт",
  learning: "Обучение",
  observation: "Наблюдение",
  travel: "Путешествия",
  finance: "Финансы",
  other: "Другое",
});

/** Telegram display: emoji + Russian label. */
export const IDEA_CATEGORY_DISPLAY_RU = Object.freeze({
  content: "🎬 Контент",
  business: "💼 Бизнес",
  project: "🛠 Проект",
  life: "🌱 Жизнь",
  health: "❤️ Здоровье",
  sport: "🏃 Спорт",
  learning: "📚 Обучение",
  observation: "👁 Наблюдение",
  travel: "✈️ Путешествия",
  finance: "💰 Финансы",
  other: "✨ Другое",
});

export const IDEA_LOW_CONFIDENCE = 0.55;
export const IDEA_LIST_PAGE_SIZE = 10;
export const IDEA_RELATED_SIMILARITY = 0.72;

/**
 * @param {string} category
 * @returns {boolean}
 */
export function isIdeaCategory(category) {
  return IDEA_CATEGORIES.includes(String(category || "").trim().toLowerCase());
}

/**
 * @param {string} category
 * @returns {string}
 */
export function normalizeIdeaCategory(category) {
  const c = String(category || "")
    .trim()
    .toLowerCase();
  return isIdeaCategory(c) ? c : "other";
}

/**
 * @param {string} category
 * @returns {string}
 */
export function ideaCategoryLabelRu(category) {
  const c = normalizeIdeaCategory(category);
  return IDEA_CATEGORY_LABELS_RU[c] || IDEA_CATEGORY_LABELS_RU.other;
}

/**
 * @param {string} category
 * @returns {string}
 */
export function ideaCategoryDisplayRu(category) {
  const c = normalizeIdeaCategory(category);
  return IDEA_CATEGORY_DISPLAY_RU[c] || IDEA_CATEGORY_DISPLAY_RU.other;
}

/**
 * Short title for list/card/API (first clause, capped).
 * @param {string} text
 * @param {number} [max=80]
 * @returns {string}
 */
export function deriveIdeaTitle(text, max = 80) {
  const raw = String(text ?? "").trim();
  if (!raw) return "Идея";
  const first = raw.split(/[\n.!?]/u)[0].trim() || raw;
  if (first.length <= max) return first;
  return `${first.slice(0, Math.max(1, max - 1)).trim()}…`;
}

/**
 * Strip light idea-prefix wrappers; keep the thought itself.
 * @param {string} text
 * @returns {string}
 */
export function normalizeIdeaText(text) {
  let t = String(text ?? "").trim();
  if (!t) return "";

  t = t
    .replace(
      /^(у\s+меня\s+)?(есть\s+)?идея\s*(для\s+\S+)?\s*[:：,—-]?\s*/iu,
      ""
    )
    .replace(/^(пришла\s+идея)\s*[:：,—-]?\s*/iu, "")
    .replace(/^(придумал|придумала)\s*[:：,—-]?\s*/iu, "")
    .replace(/^(пришла\s+мысль)\s*[:：,—-]?\s*/iu, "")
    .replace(/^(надо\s+сделать)\s*[:：,—-]?\s*/iu, "")
    .replace(/^(хочу\s+попробовать)\s*[:：,—-]?\s*/iu, "")
    .replace(/^(было\s+бы\s+круто)\s*[:：,—-]?\s*/iu, "")
    .replace(/^idea\s*(for\s+\S+)?\s*[:：,—-]?\s*/iu, "")
    .replace(/^i\s+have\s+an\s+idea\s*[:：,—-]?\s*/iu, "")
    .trim();

  if (!t) t = String(text ?? "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * @param {unknown} tags
 * @returns {string[]}
 */
export function normalizeIdeaTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = String(raw ?? "")
      .trim()
      .slice(0, 48);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}
