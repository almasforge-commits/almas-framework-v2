/**
 * Finance category detection (RU/EN).
 * Used at parse/capture time so writes are not stuck on "other".
 */

const EXPENSE_RULES = {
  Напитки: [
    "кофе",
    "колу",
    "кола",
    "кока-кола",
    "кока кола",
    "кока",
    "чай",
    "латте",
    "капучино",
    "американо",
    "сок",
    "вода",
    "напиток",
    "espresso",
    "coffee",
    "coca-cola",
    "coca cola",
    "cola",
  ],
  Продукты: [
    "магазин",
    "магнит",
    "пятерочка",
    "лента",
    "перекресток",
    "продукты",
    "еда",
    "groceries",
  ],
  Кафе: [
    "бургер",
    "шаурма",
    "ресторан",
    "кафе",
    "мак",
    "kfc",
    "обед",
    "ужин",
    "завтрак",
    "lunch",
    "dinner",
  ],
  Транспорт: [
    "такси",
    "метро",
    "автобус",
    "бензин",
    "газ",
    "азс",
    "аэропорт",
    "uber",
    "grab",
    "транспорт",
    "taxi",
  ],
  Развлечения: ["steam", "игра", "кино", "театр", "netflix", "spotify"],
  Здоровье: ["аптека", "лекарство", "врач", "стоматолог", "клиника"],
  Одежда: ["куртка", "обувь", "кроссовки", "одежда"],
  Подписки: ["подписк", "subscription", "gpt", "openai", "netflix", "spotify"],
  Техника: ["iphone", "macbook", "ноутбук", "телефон", "gadget"],
};

const INCOME_RULES = {
  Доход: [
    "консультац",
    "consultation",
    "фриланс",
    "freelance",
    "зарплат",
    "salary",
    "аванс",
    "премия",
    "бонус",
    "продажа",
    "продал",
    "проект",
    "заказ",
    "клиент",
    "гонорар",
    "дивиденд",
    "кэшбэк",
    "возврат",
  ],
};

/**
 * @param {string} text
 * @param {"expense"|"income"|null} [direction]
 * @returns {string|null}
 */
export function detectCategory(text = "", direction = null) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;

  if (direction === "income" || !direction) {
    for (const [category, words] of Object.entries(INCOME_RULES)) {
      if (words.some((word) => t.includes(word))) return category;
    }
  }

  if (direction === "income") return null;

  for (const [category, words] of Object.entries(EXPENSE_RULES)) {
    if (words.some((word) => t.includes(word))) return category;
  }

  return null;
}

/**
 * Resolve category for a finance write.
 * @param {object} input
 */
export function resolveFinanceCategory(input = {}) {
  const explicit = String(input.category || "").trim();
  if (explicit && explicit.toLowerCase() !== "other") return explicit;
  const description = String(input.description || input.content || "").trim();
  const direction =
    input.type === "income" || input.type === "finance_income"
      ? "income"
      : input.type === "expense" || input.type === "finance_expense"
        ? "expense"
        : null;
  return detectCategory(description, direction) || "other";
}
