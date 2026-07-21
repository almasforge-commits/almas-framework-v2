import { validateInformationKinds } from "./inboxContracts.js";
import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import { isMeaninglessShortInput } from "../../core/utils/isMeaninglessShortInput.js";
import { normalizeUserText } from "../../core/utils/normalizeUserText.js";

// Pure information-kind classifier. Maps AI action types + conservative
// deterministic hints. Never executes domain actions. No OpenAI /
// Supabase / Telegram / domain-service imports.

const ACTION_TO_KIND = Object.freeze({
  finance_expense: "finance",
  finance_income: "finance",
  task_create: "task",
  memory_save: "memory",
  idea_create: "idea",
  knowledge_query: "knowledge",
  search: "search",
  chat: "chat",
  system_command: "command",
  unknown: "unknown",
});

// Prefer (^|\\s|punct) over \\b for Cyrillic — JS \\b is ASCII-word only.
const IDEA_PATTERNS = [
  /^\s*идея\s*[:：]/i,
  /^\s*идея\s+для(?:\s|$)/i,
  /^\s*у\s+меня\s+идея(?:\s|$|[:：])/i,
  /^\s*idea\s*[:：]/i,
  /^\s*idea\s+for\b/i,
  /^\s*идея(?:\s|$)/i,
];

const PROJECT_PATTERNS = [
  /^\s*проект\s*[:：]/i,
  /(?:^|[\s,.;:!?])проект\s+almas(?:\s|$|[:：])/i,
  /(?:^|[\s,.;:!?])по\s+проекту\s+almas(?:\s|$|[:：])/i,
  /^\s*project\s*[:：]/i,
  /\bproject\s+almas\b/i,
  /(?:^|[\s,.;:!?])update\s+по\s+проекту(?:\s|$|[:：])/i,
];

// Structured health phrases — deliberately narrow to avoid "вес/sleep"
// false positives in unrelated sentences.
const HEALTH_PATTERNS = [
  /(?:^|[\s,.;:!?])вес\s+\d+([.,]\d+)?(?:\s*(?:кг|kg))?(?=[\s,.;:!?]|$)/i,
  /\bweight\s+\d+([.,]\d+)?(?:\s*kg)?\b/i,
  /(?:^|[\s,.;:!?])давление\s+\d{2,3}\s*(?:на|\/)\s*\d{2,3}(?=[\s,.;:!?]|$)/i,
  /\bblood\s+pressure\s+\d{2,3}\s*\/\s*\d{2,3}\b/i,
  /(?:^|[\s,.;:!?])пульс\s+\d{2,3}(?=[\s,.;:!?]|$)/i,
  /\bpulse\s+\d{2,3}\b/i,
  /(?:^|[\s,.;:!?])(?:прошёл|прошел|прошла)\s+\d+\s*шаг/i,
  /\b\d+\s*steps?\b/i,
  /(?:^|[\s,.;:!?])сон\s+\d+([.,]\d+)?(?:\s*(?:час|часа|часов|h|hours?))?(?=[\s,.;:!?]|$)/i,
  /\bsleep\s+\d+([.,]\d+)?(?:\s*(?:h|hours?))?\b/i,
  /(?:^|[\s,.;:!?])тренировка\s+\d+(?:\s*(?:мин|минут|минуты|min|minutes?))?(?=[\s,.;:!?]|$)/i,
  /\bworkout\s+\d+(?:\s*(?:min|minutes?))?\b/i,
];

function pushUnique(list, seen, value, reason, reasons) {
  if (seen.has(value)) return;
  seen.add(value);
  list.push(value);
  if (reason) reasons.push(reason);
}

/**
 * @param {{ normalizedText?: string, text?: string, routingDecision?: object|null, sourceType?: string|null }} input
 * @returns {{ informationKinds: string[], reasonCodes: string[] }}
 */
export function classifyInformationKinds(input = {}) {
  const text = normalizeUserText(input.normalizedText ?? input.text ?? "");
  const decision = input.routingDecision ?? null;
  const sourceType = input.sourceType ?? null;

  const kinds = [];
  const reasons = [];
  const seen = new Set();

  if (isMenuNavigationCommand(text) || isMeaninglessShortInput(text)) {
    pushUnique(kinds, seen, "unknown", "meaningless_or_menu", reasons);
    return {
      informationKinds: validateInformationKinds(kinds),
      reasonCodes: reasons,
    };
  }

  const actions = Array.isArray(decision?.actions) ? decision.actions : [];

  for (const action of actions) {
    const mapped = ACTION_TO_KIND[action?.type];
    if (!mapped) continue;
    if (mapped === "unknown" && actions.length > 1) continue;
    pushUnique(kinds, seen, mapped, `action:${action.type}`, reasons);
  }

  if (sourceType === "youtube") {
    pushUnique(kinds, seen, "knowledge", "source:youtube", reasons);
  }

  if (text) {
    if (IDEA_PATTERNS.some((re) => re.test(text))) {
      pushUnique(kinds, seen, "idea", "hint:idea", reasons);
    }

    if (HEALTH_PATTERNS.some((re) => re.test(text))) {
      pushUnique(kinds, seen, "health", "hint:health", reasons);
    }

    if (PROJECT_PATTERNS.some((re) => re.test(text))) {
      pushUnique(kinds, seen, "project", "hint:project", reasons);
    }
  }

  if (kinds.length === 0) {
    pushUnique(kinds, seen, "unknown", "no_kind", reasons);
  }

  // Drop trailing "unknown" if any real kind was identified.
  const filtered = kinds.filter((kind, index) => {
    if (kind !== "unknown") return true;
    return kinds.length === 1 && index === 0;
  });

  return {
    informationKinds: validateInformationKinds(filtered.length ? filtered : ["unknown"]),
    reasonCodes: reasons,
  };
}
