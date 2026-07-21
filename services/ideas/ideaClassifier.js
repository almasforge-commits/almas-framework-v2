/**
 * Idea classification — AI when available, deterministic fallback always.
 * Never blocks capture on classification failure.
 */

import { askAI } from "../../providers/ai/openaiProvider.js";
import {
  IDEA_LOW_CONFIDENCE,
  normalizeIdeaCategory,
  normalizeIdeaTags,
  normalizeIdeaText,
} from "./ideaContracts.js";

const CLASSIFY_SCHEMA = {
  name: "idea_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category: {
        type: "string",
        enum: [
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
        ],
      },
      confidence: { type: "number" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      relatedProject: { type: ["string", "null"] },
      relatedMemoryHint: { type: ["string", "null"] },
      language: {
        type: "string",
        enum: ["ru", "en", "kk", "mixed", "unknown"],
      },
    },
    required: [
      "category",
      "confidence",
      "tags",
      "relatedProject",
      "relatedMemoryHint",
      "language",
    ],
  },
};

/**
 * @param {string} text
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function classifyIdea(text, opts = {}) {
  const content = normalizeIdeaText(text);
  const heuristic = classifyIdeaDeterministic(content);

  if (opts.skipAi === true) {
    return heuristic;
  }

  try {
    const ai = await askAI(
      [
        "You classify user ideas for a second-brain assistant.",
        "Pick one category, confidence 0..1, up to 6 short tags.",
        "relatedProject / relatedMemoryHint only when clearly grounded — else null.",
        "Do not invent facts. Prefer 'other' when unsure.",
      ].join(" "),
      content.slice(0, 2000),
      CLASSIFY_SCHEMA,
      { model: opts.model }
    );

    if (!ai || typeof ai !== "object") return heuristic;

    const category = normalizeIdeaCategory(ai.category);
    let confidence = Number(ai.confidence);
    if (!Number.isFinite(confidence)) confidence = heuristic.confidence;
    confidence = Math.max(0, Math.min(1, confidence));

    // Low confidence → still save, but force category other for UX buttons.
    const low = confidence < (opts.lowConfidence ?? IDEA_LOW_CONFIDENCE);
    return {
      category: low ? "other" : category,
      confidence,
      tags: normalizeIdeaTags(ai.tags?.length ? ai.tags : heuristic.tags),
      language: ai.language || heuristic.language,
      relatedProject:
        typeof ai.relatedProject === "string" && ai.relatedProject.trim()
          ? ai.relatedProject.trim().slice(0, 120)
          : null,
      relatedMemoryHint:
        typeof ai.relatedMemoryHint === "string" && ai.relatedMemoryHint.trim()
          ? ai.relatedMemoryHint.trim().slice(0, 200)
          : null,
      lowConfidence: low,
      source: "ai",
      normalizedText: content,
    };
  } catch {
    return { ...heuristic, source: "deterministic_fallback" };
  }
}

/**
 * @param {string} text
 * @returns {object}
 */
export function classifyIdeaDeterministic(text) {
  const content = normalizeIdeaText(text);
  const lower = content.toLowerCase();

  let category = "other";
  let confidence = 0.5;
  const tags = [];

  const rules = [
    {
      cat: "content",
      re: /youtube|контент|видео|блог|рилл|reels|shorts|подкаст|тикт|тикток|канал|channel/i,
    },
    {
      cat: "business",
      re: /бизнес|стартап|startup|клиент|продаж|revenue|маркетинг/i,
    },
    {
      cat: "project",
      re: /проект|almas|продукт|product|app|приложение|фич/i,
    },
    { cat: "health", re: /здоров|сон|вес|whoop|habit|привычк/i },
    { cat: "sport", re: /спорт|тренир|бег|зал|workout|gym/i },
    {
      cat: "learning",
      re: /учить|обучен|курс|книг|learn|study|английск/i,
    },
    { cat: "travel", re: /путешеств|vietnam|вьетнам|поездк|flight|visa/i },
    { cat: "finance", re: /инвест|бюджет|доход|расход|financ|money/i },
    { cat: "life", re: /жизнь|быт|дом|семь|отношен/i },
    { cat: "observation", re: /заметил|наблюд|кажется|интересн/i },
  ];

  for (const rule of rules) {
    if (rule.re.test(lower)) {
      category = rule.cat;
      confidence = 0.7;
      break;
    }
  }

  if (/vietnam|вьетнам/i.test(lower)) tags.push("Vietnam");
  if (/youtube/i.test(lower)) tags.push("YouTube");
  if (/almas/i.test(lower)) tags.push("ALMAS");
  if (/бизнес|business/i.test(lower)) tags.push("Business");
  if (/кофе|coffee/i.test(lower)) tags.push("Coffee");

  const language = /[а-яё]/i.test(content)
    ? /[a-z]/i.test(content)
      ? "mixed"
      : "ru"
    : /[a-z]/i.test(content)
      ? "en"
      : "unknown";

  const low = confidence < IDEA_LOW_CONFIDENCE;
  return {
    category: low ? "other" : category,
    confidence,
    tags: normalizeIdeaTags(tags),
    language,
    relatedProject: null,
    relatedMemoryHint: null,
    lowConfidence: low,
    source: "deterministic",
    normalizedText: content,
  };
}
