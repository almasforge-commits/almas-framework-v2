/**
 * Deterministic Personal Knowledge classifier (RU/EN).
 * No LLM. Never invents content or entities.
 *
 * Note: JS `\b` is ASCII-oriented and unreliable for Cyrillic — use
 * start/whitespace anchors instead (same approach as finance parsers).
 */

import {
  mapRegistryKindToPersonalDomain,
  normalizePersonalContent,
} from "./personalKnowledgeContracts.js";

/** Left edge for a keyword (start or whitespace/punctuation). */
const L = "(?:^|[\\s,.:;!?«»\"'(\\-—])";
/** Right edge for a keyword. */
const R = "(?=$|[\\s,.:;!?«»\"')\\-—])";

function re(body, flags = "i") {
  return new RegExp(`${L}${body}${R}`, flags);
}

const RULES = Object.freeze([
  {
    domain: "Identity",
    confidence: 0.9,
    patterns: [
      re("меня зовут"),
      re("my name is"),
      /(?:^|\s)я\s+(живу|работаю|из)\b/i,
      /\bi\s+(live|work|am)\s+(in|as|a)\b/i,
      /(?:^|\s)я\s*[-—]\s+/i,
    ],
  },
  {
    domain: "Preferences",
    confidence: 0.88,
    patterns: [
      re("мне нравится"),
      re("я предпочитаю"),
      re("предпочитаю"),
      re("не люблю"),
      /\bi (like|prefer|love|hate)\b/i,
    ],
  },
  {
    domain: "Goals",
    confidence: 0.88,
    patterns: [
      re("моя цель"),
      re("хочу достичь"),
      re("my goal"),
      /\bi want to (achieve|reach|become)\b/i,
      /(?:^|\s)цель\s*[:—-]/i,
    ],
  },
  {
    domain: "Projects",
    confidence: 0.85,
    patterns: [
      re("проект(?:у|а|ом|е|ы)?"),
      re("project"),
      re("работаю над"),
      re("working on"),
    ],
  },
  {
    domain: "Ideas",
    confidence: 0.85,
    patterns: [
      re("идея"),
      re("idea"),
      re("было бы круто"),
      re("what if"),
    ],
  },
  {
    domain: "Health",
    confidence: 0.85,
    patterns: [
      re("вес"),
      re("weight"),
      re("давление"),
      re("сон"),
      re("sleep"),
      re("health"),
      re("шаг(?:ов|и|а)?"),
    ],
  },
  {
    domain: "Contacts",
    confidence: 0.85,
    patterns: [
      re("контакт"),
      re("contact"),
      re("телефон"),
      re("phone"),
      re("email"),
    ],
  },
  {
    domain: "Decisions",
    confidence: 0.88,
    patterns: [
      re("я решил"),
      re("я решила"),
      re("my decision"),
      /\bi decided(?:\s+to)?\b/i,
      /(?:^|\s)решение\s*[:—-]/i,
    ],
  },
  {
    domain: "Habits",
    confidence: 0.86,
    patterns: [
      re("привычка"),
      re("habit"),
      re("каждый день"),
      re("every day"),
      re("ежедневно"),
      re("обычно я"),
      re("i usually"),
    ],
  },
  {
    domain: "Finance",
    confidence: 0.8,
    patterns: [
      re("потратил"),
      re("доход"),
      re("expense"),
      re("income"),
      re("бюджет"),
      re("budget"),
    ],
  },
  {
    domain: "Tasks",
    confidence: 0.85,
    patterns: [
      re("задача"),
      re("task"),
      re("нужно"),
      re("надо"),
      re("todo"),
      re("напомни"),
      re("remind me"),
    ],
  },
  {
    domain: "Knowledge",
    confidence: 0.75,
    patterns: [
      re("запомни"),
      re("remember that"),
      re("важно знать"),
      re("i learned"),
      re("я узнал"),
      re("я узнала"),
    ],
  },
]);

/** Phrases that indicate world/general knowledge, not personal facts. */
const WORLD_PATTERNS = Object.freeze([
  re("столица"),
  re("capital of"),
  /\bwhat is the\b/i,
  re("кто такой"),
  /\bwho is\b/i,
  /\bwikipedia\b/i,
  /\baccording to (scientists|research|wikipedia)\b/i,
  re("по данным"),
  re("в мире"),
  /\bin the world\b/i,
  /\bdistance from .+ to\b/i,
  re("сколько километров"),
]);

/**
 * @param {string} text
 * @param {object} [options]
 * @param {{ kind?: string, confidence?: number }|null} [options.candidate]
 * @returns {{ domain: string|null, confidence: number, scope: 'personal'|'world', reason?: string }}
 */
export function classifyPersonalKnowledge(text, options = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { domain: null, confidence: 0, scope: "personal", reason: "empty" };
  }

  if (WORLD_PATTERNS.some((pattern) => pattern.test(raw))) {
    return {
      domain: null,
      confidence: 0,
      scope: "world",
      reason: "world_or_general",
    };
  }

  const candidate =
    options.candidate && typeof options.candidate === "object"
      ? options.candidate
      : null;

  let best = { domain: null, confidence: 0, scope: "personal" };

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(raw))) {
      if (rule.confidence > best.confidence) {
        best = {
          domain: rule.domain,
          confidence: rule.confidence,
          scope: "personal",
        };
      }
    }
  }

  if (candidate?.kind) {
    const mapped = mapRegistryKindToPersonalDomain(candidate.kind);
    if (mapped === "Timeline") {
      return {
        domain: "Timeline",
        confidence: 0,
        scope: "personal",
        reason: "timeline_not_writable",
      };
    }
    if (mapped) {
      const candidateConf = Number.isFinite(candidate.confidence)
        ? Math.min(1, Math.max(0, candidate.confidence))
        : 0.8;
      if (!best.domain) {
        best = {
          domain: mapped,
          confidence: Math.max(candidateConf, 0.75),
          scope: "personal",
        };
      } else if (best.domain === mapped) {
        best = {
          ...best,
          confidence: Math.min(
            1,
            Math.max(best.confidence, candidateConf) + 0.05
          ),
        };
      }
    }
  }

  if (!best.domain) {
    const normalized = normalizePersonalContent(raw);
    if (
      /^(я|мне|мой|моя|моё|мои|i |my |me )\b/i.test(normalized) &&
      normalized.length >= 12
    ) {
      best = {
        domain: "Knowledge",
        confidence: 0.72,
        scope: "personal",
      };
    }
  }

  return best;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeWorldOrGeneralKnowledge(text) {
  return WORLD_PATTERNS.some((pattern) => pattern.test(String(text ?? "")));
}
