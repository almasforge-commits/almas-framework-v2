/**
 * Deterministic memory quality classifier.
 * Drops navigation / system labels accidentally stored as legacy memories.
 */

import { normalizeCommandText } from "../../core/utils/normalizeUserText.js";
import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import { normalizeMemoryFactContent } from "../storage/memoryFilter.js";

/** Exact / near-exact navigation & system labels (normalized). */
const SYSTEM_LABELS = new Set(
  [
    "мои задачи",
    "мои доходы",
    "мои расходы",
    "мои знания",
    "выполненные задачи",
    "баланс",
    "история",
    "статистика",
    "меню",
    "настройки",
    "знания",
    "финансы",
    "проекты",
    "идеи",
    "память",
    "помощь",
    "главная",
    "открыть almas",
    "youtube",
    "help",
    "start",
    "/start",
    "список",
    "задачи",
    "доходы",
    "расходы",
  ].map((s) => normalizeQualityText(s))
);

/**
 * True when content is only a menu / command / system phrase.
 * @param {string} content
 * @returns {boolean}
 */
export function isNavigationOrSystemMemory(content) {
  const raw = normalizeMemoryFactContent(content);
  if (!raw) return true;

  if (isMenuNavigationCommand(raw) || isMenuNavigationCommand(content)) {
    return true;
  }

  const n = normalizeQualityText(raw);
  if (!n) return true;
  if (SYSTEM_LABELS.has(n)) return true;

  if (
    /^(мои\s+)?(задачи|доходы|расходы|знания|финансы|проекты|идеи|настройки|память)\.?$/iu.test(
      n
    )
  ) {
    return true;
  }

  if (
    /^(баланс|история|статистика|меню|помощь|help|start|список)\.?$/iu.test(n)
  ) {
    return true;
  }

  if (
    /^(открой|открыть|покажи|показать|список|найди|найти)(?:\s|$)/iu.test(raw) &&
    raw.length <= 40
  ) {
    return true;
  }

  // "открыть знания" / "открыть almas" style stubs
  if (/^открыть\s+\S+/iu.test(raw) && raw.length <= 40) {
    return true;
  }

  const tokens = n.split(/\s+/).filter(Boolean);
  if (
    tokens.length <= 2 &&
    !hasPersonalSignal(raw) &&
    /^(задач|доход|расход|баланс|истори|меню|знани|финанс|проект|иде|youtube)/iu.test(
      n
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Only memories that are facts about the user.
 * Used for about_me / preferences / memory recall.
 *
 * @param {string|object} memoryOrContent
 * @returns {boolean}
 */
export function isUserFact(memoryOrContent) {
  const content =
    typeof memoryOrContent === "string"
      ? memoryOrContent
      : memoryOrContent?.content ?? memoryOrContent?.text ?? "";

  const raw = normalizeMemoryFactContent(content);
  if (!raw) return false;

  if (isNavigationOrSystemMemory(raw)) return false;

  // Task / finance command-shaped rows are not about-me facts.
  if (/^(купи|купить|позвони|позвонить|сделать|нужно)\b/iu.test(raw)) {
    return false;
  }
  if (/^(потратил|потратить|расход|доход|оплатил|купил)\b/iu.test(raw)) {
    return false;
  }

  if (isPreferenceLikeContent(raw)) return true;

  if (
    /^(меня\s+зовут|меня\s+звать|я\s+живу|я\s+работаю|работаю\b|живу\b|зовут\b|моя\s+цель|мой\s+цель|хочу\b|планирую\b|я\s+предпочитаю|мне\s+важно)/iu.test(
      raw
    )
  ) {
    return true;
  }

  if (
    /^(my\s+name\s+is|i\s+live|i\s+work|i\s+like|i\s+prefer|i\s+am|i'?m\b)/iu.test(
      raw
    )
  ) {
    return true;
  }

  if (hasPersonalSignal(raw) && raw.length >= 12) {
    return true;
  }

  return false;
}

function isPreferenceLikeContent(content) {
  return /нрав|предпочит|like|prefer|любл|люби|dislike|habit|привыч|favourite|favorite|работаю|работать|стиль/iu.test(
    String(content || "")
  );
}

function hasPersonalSignal(text) {
  return /(?:^|[^\p{L}])(мне|меня|мной|я|мой|моя|моё|мое|мои|my|i|me)\b/iu.test(
    String(text ?? "")
  );
}

function normalizeQualityText(text) {
  return normalizeCommandText(String(text ?? ""))
    .replace(/[^\p{L}\p{N}\s/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
