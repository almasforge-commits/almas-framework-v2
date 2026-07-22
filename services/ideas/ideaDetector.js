/**
 * Deterministic idea detection — natural language, no forced command.
 * Pure: no I/O.
 */

import { normalizeIdeaText } from "./ideaContracts.js";

const STRONG_PATTERNS = [
  /^\s*идея\s*[:：]/iu,
  /^\s*идея\s+для(?:\s|$)/iu,
  /^\s*у\s+меня\s+идея(?:\s|$|[:：])/iu,
  /^\s*есть\s+идея(?:\s|$|[:：])/iu,
  /^\s*пришла\s+идея(?:\s|$|[:：])/iu,
  /^\s*появилась\s+идея(?:\s|$|[:：])/iu,
  /^\s*появилась\s+мысль(?:\s|$|[:：])/iu,
  /^\s*пришла\s+мысль(?:\s|$|[:：])/iu,
  /^\s*придумал(?:а)?(?:\s|$|[:：])/iu,
  /^\s*было\s+бы\s+круто(?:\s|$)/iu,
  /^\s*хочу\s+попробовать(?:\s|$)/iu,
  /^\s*надо\s+сделать(?:\s|$)/iu,
  /^\s*idea\s*[:：]/iu,
  /^\s*i\s+have\s+an\s+idea(?:\s|$|[:：])/iu,
  /^\s*what\s+if(?:\s|$)/iu,
];

/** Confidence floor for Telegram/legacy auto-capture (bypass Memory). */
export const STRONG_IDEA_CONFIDENCE = 0.85;

const SOFT_PATTERNS = [
  /\bидея\b/iu,
  /\bмысль\b/iu,
  /\bстартап\b/iu,
  /\bконтент\b/iu,
  /\byoutube\b/iu,
  /\bбизнес\b/iu,
  /\bпроект\b/iu,
  /\bпопробовать\b/iu,
  /\bcould\s+build\b/iu,
  /\bwould\s+be\s+cool\b/iu,
  /\bstartup\b/iu,
  /\bcontent\s+idea\b/iu,
];

/**
 * @param {string} text
 * @returns {{ isIdea: boolean, confidence: number, reason: string, content: string|null }}
 */
export function detectIdea(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || trimmed.length < 4) {
    return { isIdea: false, confidence: 0, reason: "too_short", content: null };
  }

  // Explicit memory/task/finance commands are not ideas.
  if (
    /^(запомни|запомнить|remember|купи|купить|потратил|потратила|получил|получила|заработал|заработала|расход|доход)\b/iu.test(
      trimmed
    ) ||
    /\b(потратил|потратила|получил|получила|заработал|заработала)\b/iu.test(
      trimmed
    ) ||
    /(\d+(?:[.,]\d+)?)\s*(k|к|тыс|тысяч|тысячи|vnd|usd|доллар)/iu.test(trimmed)
  ) {
    return {
      isIdea: false,
      confidence: 0,
      reason: "other_domain_command",
      content: null,
    };
  }

  for (const re of STRONG_PATTERNS) {
    if (re.test(trimmed)) {
      return {
        isIdea: true,
        confidence: 0.92,
        reason: "strong_idea_pattern",
        content: normalizeIdeaText(trimmed),
      };
    }
  }

  let softHits = 0;
  for (const re of SOFT_PATTERNS) {
    if (re.test(trimmed)) softHits += 1;
  }

  // Soft: idea-ish language with enough substance, not a bare menu label.
  if (softHits >= 1 && trimmed.length >= 16 && /[а-яёa-z]/iu.test(trimmed)) {
    // Prefer soft only when it looks like a proposal, not a query.
    if (
      /^(какие|покажи|найди|найти|что\s+ты|what\s+do|show\s+me|list)\b/iu.test(
        trimmed
      ) ||
      (/\bидеи\b/iu.test(trimmed) &&
        /^(какие|покажи|найди|мои)/iu.test(trimmed))
    ) {
      return {
        isIdea: false,
        confidence: 0,
        reason: "retrieval_query",
        content: null,
      };
    }
    return {
      isIdea: true,
      confidence: softHits >= 2 ? 0.72 : 0.62,
      reason: "soft_idea_pattern",
      content: normalizeIdeaText(trimmed),
    };
  }

  return { isIdea: false, confidence: 0, reason: "not_idea", content: null };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeIdea(text) {
  return detectIdea(text).isIdea;
}

/**
 * Strong, confident idea phrases that must use Ideas capture (text + voice).
 * @param {string} text
 * @returns {boolean}
 */
export function isStrongIdeaCapture(text) {
  const d = detectIdea(text);
  return d.isIdea === true && d.confidence >= STRONG_IDEA_CONFIDENCE;
}
