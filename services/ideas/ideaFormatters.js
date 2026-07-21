/**
 * Domain-specific Ideas Telegram formatters.
 * Lists/cards belong in Mini App; Telegram stays confirmation-thin.
 */

import {
  IDEA_CORRECTION_CATEGORIES,
  IDEA_LIST_PAGE_SIZE,
  deriveIdeaTitle,
  ideaCategoryDisplayRu,
  ideaCategoryLabelRu,
  normalizeIdeaCategory,
} from "./ideaContracts.js";
import {
  ideasPath,
  THIN_CONFIRM,
  withMiniAppOpenButton,
} from "../../config/deepLinks.js";

/**
 * Confirmation after save / category update.
 * @param {object} idea
 * @returns {{ text: string, reply_markup: object }}
 */
export function formatIdeaSaved(idea) {
  const category = normalizeIdeaCategory(idea?.category);
  const base = {
    reply_markup: buildCategoryKeyboard(idea?.id, category),
  };
  const withOpen = withMiniAppOpenButton(
    base,
    ideasPath(idea?.id),
    THIN_CONFIRM.openIdeas
  );

  return {
    text: `${THIN_CONFIRM.idea}\n\n${THIN_CONFIRM.openAlmas}`,
    reply_markup: withOpen.reply_markup,
  };
}

/**
 * Numbered list experience (not a prose summary).
 * @param {object} input
 * @param {object[]} input.ideas
 * @param {number} [input.total]
 * @param {number} [input.pageSize]
 * @param {boolean} [input.menuStyle] — main-menu header + category under each item
 * @returns {string}
 */
export function formatIdeaList(input = {}) {
  const ideas = Array.isArray(input.ideas) ? input.ideas : [];
  const total = Number.isFinite(Number(input.total))
    ? Number(input.total)
    : ideas.length;
  const pageSize = Math.min(
    Math.max(Number(input.pageSize) || IDEA_LIST_PAGE_SIZE, 1),
    20
  );
  const menuStyle = input.menuStyle === true;

  if (total === 0 || ideas.length === 0) {
    if (menuStyle) {
      return [
        "💡 Пока идей нет.",
        "",
        "Напишите или скажите:",
        "«У меня идея...»",
      ].join("\n");
    }
    return "💡 У тебя пока нет сохранённых идей.";
  }

  const shown = ideas.slice(0, pageSize);
  const lines = menuStyle
    ? [`💡 Ваши идеи — ${total}`, ""]
    : [`💡 У тебя ${total} ${pluralIdeas(total)}`, ""];

  shown.forEach((idea, i) => {
    const title = deriveIdeaTitle(
      idea.title || idea.normalizedText || idea.originalText || ""
    );
    lines.push(`${i + 1}. ${title}`);
    if (menuStyle) {
      lines.push(`   ${ideaCategoryDisplayRu(idea.category)}`);
      lines.push("");
    }
  });

  // Trim trailing blank from menuStyle loop.
  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const remaining = Math.max(0, total - shown.length);
  if (remaining > 0) {
    lines.push("");
    lines.push(`...ещё ${remaining}`);
  }

  return lines.join("\n");
}

/**
 * Full idea card for open-by-index.
 * @param {object} idea
 * @param {object} [opts]
 * @param {number} [opts.index]
 * @param {object[]} [opts.relatedIdeas]
 * @returns {string}
 */
export function formatIdeaCard(idea, opts = {}) {
  if (!idea) return "❌ Идея не найдена.";

  const index = opts.index != null ? Number(opts.index) : null;
  const title = deriveIdeaTitle(
    idea.title || idea.normalizedText || idea.originalText || ""
  );
  const body = String(
    idea.normalizedText || idea.originalText || idea.content || ""
  ).trim();
  const category = normalizeIdeaCategory(idea.category);
  const tags = Array.isArray(idea.tags) ? idea.tags.filter(Boolean) : [];
  const related =
    Array.isArray(opts.relatedIdeas) && opts.relatedIdeas.length
      ? opts.relatedIdeas
      : Array.isArray(idea.relatedIdeas)
        ? idea.relatedIdeas
        : [];

  const lines = [
    index != null && Number.isFinite(index)
      ? `💡 Идея ${index}`
      : "💡 Идея",
    "",
    `Название:\n${title}`,
    "",
    `Текст:\n${body}`,
    "",
    `Раздел:\n${ideaCategoryDisplayRu(category)}`,
  ];

  if (tags.length) {
    lines.push("", `Теги:\n${tags.slice(0, 12).map((t) => `• ${t}`).join("\n")}`);
  }

  if (idea.createdAt) {
    lines.push("", `Создано:\n${formatDateRu(idea.createdAt)}`);
  }

  const conf = Number(idea.confidence);
  if (Number.isFinite(conf)) {
    lines.push("", `Уверенность:\n${Math.round(conf * 100)}%`);
  }

  if (related.length) {
    lines.push("", "Похожие идеи:");
    related.slice(0, 5).forEach((rel) => {
      const relTitle = deriveIdeaTitle(
        rel.title || rel.normalizedText || rel.originalText || rel.id || ""
      );
      const num =
        rel.listIndex != null ? `№${rel.listIndex}` : rel.id ? String(rel.id).slice(0, 8) : "";
      lines.push(`• ${num ? `${num} — ` : ""}${relTitle}`);
    });
  }

  return lines.join("\n");
}

/**
 * Search results list (domain formatter, not Answer prose).
 * @param {object} input
 * @param {string} [input.query]
 * @param {object[]} input.ideas
 * @param {string|null} [input.category]
 * @returns {string}
 */
export function formatIdeaSearch(input = {}) {
  const ideas = Array.isArray(input.ideas) ? input.ideas : [];
  const query = String(input.query ?? "").trim();
  const category = input.category
    ? normalizeIdeaCategory(input.category)
    : null;

  if (!ideas.length) {
    const hint = category
      ? ` в разделе ${ideaCategoryLabelRu(category)}`
      : query
        ? ` по запросу «${query.slice(0, 60)}»`
        : "";
    return `💡 Ничего не нашёл${hint}.`;
  }

  const headerParts = ["💡 Найдено идей:", String(ideas.length)];
  if (category) headerParts.push(`· ${ideaCategoryDisplayRu(category)}`);

  const lines = [headerParts.join(" "), ""];
  ideas.slice(0, IDEA_LIST_PAGE_SIZE).forEach((idea, i) => {
    const title = deriveIdeaTitle(
      idea.title || idea.normalizedText || idea.originalText || ""
    );
    const cat = ideaCategoryLabelRu(idea.category);
    lines.push(`${i + 1}. ${title} (${cat})`);
  });

  if (ideas.length > IDEA_LIST_PAGE_SIZE) {
    lines.push("");
    lines.push(`...ещё ${ideas.length - IDEA_LIST_PAGE_SIZE}`);
  }

  return lines.join("\n");
}

function buildCategoryKeyboard(ideaId, category) {
  const buttons = IDEA_CORRECTION_CATEGORIES.map((cat) => {
    const label = ideaCategoryLabelRu(cat);
    const prefix = cat === category ? "✅ " : "";
    return {
      text: `${prefix}${label}`,
      callback_data: `idea:cat:${ideaId}:${cat}`,
    };
  });
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 3) {
    keyboard.push(buttons.slice(i, i + 3));
  }
  return { inline_keyboard: keyboard };
}

function pluralIdeas(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "идея";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "идеи";
  return "идей";
}

function formatDateRu(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
