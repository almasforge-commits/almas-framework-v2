/**
 * Decide whether a message should open a Capture Session (confirm-first).
 * Pure — no I/O.
 */

import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import { isMeaninglessShortInput } from "../../core/utils/isMeaninglessShortInput.js";
import { normalizeCommandText } from "../../core/utils/normalizeUserText.js";
import { parseFinanceQuery } from "../finance/financeQueryParser.js";
import { isKnowledgeOpenCommand, isKnowledgeListCommand } from "../ideas/ideaQueryIntent.js";
import { isIdeasListQuery, isIdeasOpenQuery, isIdeasRetrievalQuery } from "../ideas/ideaQueryIntent.js";
import { parseExactDomainCommand, isNavigationOrDomainOpenCommand } from "../navigation/navigationResolver.js";

const EXPLICIT_SINGLE_COMMANDS = new Set([
  "баланс",
  "история",
  "статистика",
  "аналитика",
  "мои задачи",
  "выполненные задачи",
  "мои знания",
  "привет",
  "меню",
  "/start",
]);

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isExplicitReadOrNavCommand(text) {
  if (!text) return true;
  if (isMenuNavigationCommand(text)) return true;
  if (isMeaninglessShortInput(text)) return true;
  if (isKnowledgeOpenCommand(text) || isKnowledgeListCommand(text)) return true;
  if (isIdeasListQuery(text) || isIdeasOpenQuery(text) || isIdeasRetrievalQuery(text)) {
    return true;
  }
  if (parseExactDomainCommand(text)) return true;
  if (isNavigationOrDomainOpenCommand(text)) {
    // Bare "открой 4" is nav-relative — not capture.
    const n = normalizeCommandText(text);
    if (/^(открой|открыть|покажи|показать)\s+\d+$/u.test(n)) return true;
    if (/^(назад|список|следующее|следующая|предыдущее|предыдущая|отмена|главная)$/u.test(n)) {
      return true;
    }
  }

  const n = normalizeCommandText(text);
  if (EXPLICIT_SINGLE_COMMANDS.has(n)) return true;
  if (/^выполнено\s+\d+$/u.test(n)) return true;
  if (/^(найди|найти|спроси|вспомни)\s+/u.test(n)) return true;
  if (parseFinanceQuery(text)?.intent) return true;

  return false;
}

/**
 * @param {string} text
 * @param {object} draft
 * @param {object} [opts]
 * @returns {boolean}
 */
export function shouldCreateCaptureSession(text, draft, opts = {}) {
  const inputSource = opts.inputSource || "text";
  const actions = Array.isArray(draft?.actions) ? draft.actions : [];

  if (isExplicitReadOrNavCommand(text)) return false;
  if (actions.length === 0) return false;

  // Mixed / multi-entity always goes through confirmation.
  if (actions.length >= 2) return true;

  // Voice with at least one writeable entity → confirm-first.
  if (inputSource === "voice" && actions.length >= 1) return true;

  // Long natural message with a single entity still confirm when mixed signals.
  const t = String(text ?? "");
  if (t.length >= 120 && actions.length >= 1) return true;

  // Multi-line or multi-clause natural dump with one strong write.
  if (
    actions.length === 1 &&
    (/\n/.test(t) || (t.match(/,/g) || []).length >= 2) &&
    t.length >= 60
  ) {
    return true;
  }

  return false;
}
