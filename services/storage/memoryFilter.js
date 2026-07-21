import { isYouTubeLink } from "../content/youtubeService.js";
import { looksLikeFinanceAttempt } from "../finance/financeParser.js";
import { parseFinanceQuery } from "../finance/financeQueryParser.js";
import { normalizeCommandText } from "../../core/utils/normalizeUserText.js";
import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import { isMeaninglessShortInput } from "../../core/utils/isMeaninglessShortInput.js";
import { isStrongIdeaCapture } from "../ideas/ideaDetector.js";
import { isIdeasRetrievalQuery } from "../ideas/ideaQueryIntent.js";
import { isNavigationOrDomainOpenCommand } from "../navigation/navigationResolver.js";

// Mirrors handlers/messageHandler.js's VOICE_BLOCKED_TEXT_COMMANDS. Kept
// as its own small local list (rather than a cross-file import) so this
// guard's result never depends on messageHandler.js's control flow —
// it independently recognizes the same destructive phrase.
const DESTRUCTIVE_TEXT_COMMANDS = ["удалить все знания"];

/**
 * Deterministic legacy memory-save command parse.
 * - incomplete: bare "Запомни" / "Remember" → ask for content
 * - save: prefix forms → content is everything after the command prefix
 * - none: not an explicit memory-save command
 *
 * @param {string} text
 * @returns {{ kind: "incomplete"|"save"|"none", content: string|null }}
 */
export function extractLegacyMemorySaveContent(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { kind: "none", content: null };
  }

  const lower = trimmed.toLowerCase();

  if (
    /^(запомни|запомнить|remember)$/i.test(trimmed) ||
    /^(запомни|запомнить)[:\s]+$/i.test(trimmed) ||
    /^remember[:\s]+$/i.test(trimmed)
  ) {
    return { kind: "incomplete", content: null };
  }

  const patterns = [
    /^(запомни|запомнить)\s*,\s*что\s+(.+)$/is,
    /^(запомни|запомнить)\s+что\s+(.+)$/is,
    /^(запомни|запомнить)\s*,\s*(.+)$/is,
    /^(запомни|запомнить)\s+(.+)$/is,
    /^remember\s+that\s+(.+)$/is,
    /^remember\s+(.+)$/is,
  ];

  for (const re of patterns) {
    const match = re.exec(trimmed);
    if (!match) continue;
    const content = capitalizeMemoryFact(
      String(match[match.length - 1] ?? "").trim()
    );
    if (!content) continue;
    // Avoid treating "запомни что" alone (no payload) as save.
    if (/^(что)$/i.test(content)) {
      return { kind: "incomplete", content: null };
    }
    return { kind: "save", content };
  }

  // Prefix markers used by Answer gate / shouldSaveMemory callers.
  if (
    lower.startsWith("запомни") ||
    lower.startsWith("запомнить") ||
    lower.startsWith("remember")
  ) {
    // Unrecognized shape of an explicit remember command — do not treat as open note.
    return { kind: "incomplete", content: null };
  }

  return { kind: "none", content: null };
}

/**
 * Persistable memory fact text: strip RU/EN remember-command prefixes.
 * Existing raw command rows can be normalized on read with the same helper.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeMemoryFactContent(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";

  const extracted = extractLegacyMemorySaveContent(trimmed);
  if (extracted.kind === "save" && extracted.content) {
    return extracted.content;
  }

  // Fallback for odd punctuation still carrying an imperative prefix.
  const stripped = trimmed
    .replace(/^(запомни|запомнить)\s*,?\s*(что\s+)?/iu, "")
    .replace(/^remember\s+(that\s+)?/iu, "")
    .trim();

  if (stripped && stripped !== trimmed) {
    return capitalizeMemoryFact(stripped);
  }

  return capitalizeMemoryFact(trimmed);
}

function capitalizeMemoryFact(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Deterministic eligibility guard: decides whether a piece of
 * already-resolved text (typed or voice) should be automatically saved
 * as a Memory note.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function shouldSaveMemory(text) {
  const value = text.toLowerCase().trim();
  const normalized = normalizeCommandText(text);

  if (value === "привет") return false;
  if (value === "мои знания") return false;
  if (DESTRUCTIVE_TEXT_COMMANDS.includes(normalized)) return false;
  if (isMenuNavigationCommand(text)) return false;
  if (isMeaninglessShortInput(text)) return false;

  // Explicit bare remember → clarification asks; do not auto-save the verb.
  const memoryCmd = extractLegacyMemorySaveContent(text);
  if (memoryCmd.kind === "incomplete") return false;

  // Strong idea captures go to Ideas, not Memory (text + voice).
  if (isStrongIdeaCapture(text)) return false;
  if (isIdeasRetrievalQuery(text)) return false;

  // Navigation follow-ups + exact domain opens never become Memory.
  if (isNavigationOrDomainOpenCommand(text)) return false;

  // Finance: any recognized query intent (balance/history/statistics/
  // analytics/delete_last) or any expense/income trigger word — even if
  // the amount itself fails to parse — must never be saved as a note.
  if (parseFinanceQuery(text)?.intent) return false;
  if (looksLikeFinanceAttempt(text)) return false;

  // Knowledge / search / chat
  if (value.startsWith("найди ")) return false;
  if (value.startsWith("найти ")) return false;
  if (value.startsWith("спроси ")) return false;
  if (value.startsWith("открыть ")) return false;
  if (value.startsWith("покажи ")) return false;
  if (value.startsWith("вспомни ")) return false;
  if (value.startsWith("добавь ")) return false;
  if (value.startsWith("подумай ")) return false;
  if (value.startsWith("как думаешь")) return false;

  // Tasks
  if (value === "мои задачи") return false;
  if (value.startsWith("выполнено ")) return false;
  if (value === "выполненные задачи") return false;

  // Finance report commands.
  if (value === "баланс") return false;
  if (value === "история") return false;
  if (value === "статистика") return false;
  if (value.startsWith("сколько потратил на ")) return false;
  if (
    value === "расходы за сегодня" ||
    value === "расходы за неделю" ||
    value === "расходы за месяц"
  ) {
    return false;
  }

  if (isYouTubeLink(text)) return false;

  return true;
}
