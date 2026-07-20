import { isYouTubeLink } from "../content/youtubeService.js";
import { looksLikeFinanceAttempt } from "../finance/financeParser.js";
import { parseFinanceQuery } from "../finance/financeQueryParser.js";
import { normalizeCommandText } from "../../core/utils/normalizeUserText.js";
import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import { isMeaninglessShortInput } from "../../core/utils/isMeaninglessShortInput.js";

// Mirrors handlers/messageHandler.js's VOICE_BLOCKED_TEXT_COMMANDS. Kept
// as its own small local list (rather than a cross-file import) so this
// guard's result never depends on messageHandler.js's control flow —
// it independently recognizes the same destructive phrase.
const DESTRUCTIVE_TEXT_COMMANDS = ["удалить все знания"];

/**
 * Deterministic eligibility guard: decides whether a piece of
 * already-resolved text (typed or voice) should be automatically saved
 * as a Memory note.
 *
 * This does NOT implement Finance/Task/Knowledge/Chat business logic —
 * it only recognizes when text belongs to one of those command surfaces
 * (by calling the same parsers/detectors those features already use, or
 * matching the same command prefixes routeText() does) so recognized
 * command-like input is never accidentally stored as a note, even if a
 * downstream parser for that command later fails to fully parse it.
 * Normal notes and ideas are always left eligible.
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

  // Finance report commands. Most of these are also covered by
  // parseFinanceQuery() above; kept explicit too so this guard doesn't
  // depend on that parser's exact intent set staying in sync.
  if (value === "баланс") return false;
  if (value === "история") return false;
  if (value === "статистика") return false;
  if (value.startsWith("сколько потратил на ")) return false;
  if (
    value === "расходы за сегодня" ||
    value === "расходы за неделю" ||
    value === "расходы за месяц"
  ) return false;

  if (isYouTubeLink(text)) return false;

  return true;
}