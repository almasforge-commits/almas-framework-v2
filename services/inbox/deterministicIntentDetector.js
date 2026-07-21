import {
  parseFinanceMessage,
  looksLikeFinanceAttempt,
} from "../finance/financeParser.js";
import { parseFinanceQuery } from "../finance/financeQueryParser.js";
import { isYouTubeLink } from "../content/youtubeService.js";
import { normalizeCommandText } from "../../core/utils/normalizeUserText.js";
import { isMenuNavigationCommand } from "../../core/utils/menuNavigationCommands.js";
import { isMeaninglessShortInput } from "../../core/utils/isMeaninglessShortInput.js";
import { isStrongIdeaCapture } from "../ideas/ideaDetector.js";
import {
  isIdeasRetrievalQuery,
  isKnowledgeListCommand,
  isKnowledgeOpenCommand,
} from "../ideas/ideaQueryIntent.js";
import { createRoutingContract, createAction } from "./contracts.js";

// Tier 0 ("no AI"): reuses the SAME pure parsers/detectors the existing
// deterministic router (handlers/messageHandler.js's routeText()) already
// uses — never re-implements their business logic, and never imports a
// domain SERVICE (nothing here writes to Supabase/Telegram). This module
// only reads text and returns a routing contract or null; it never
// executes anything.
//
// Purpose: catch the clear, unambiguous cases so the (paid) AI tiers are
// only used "when rules are insufficient", per the milestone's cost
// requirement. Deliberately NOT an exhaustive re-implementation of every
// routeText() branch — anything not recognized here safely falls through
// to Tier 1, which is the correct/safe default, just not the cheapest.

const DESTRUCTIVE_TEXT_COMMANDS = ["удалить все знания"];

// A conservative signal that the message likely contains a SECOND action
// glued onto an otherwise-clean finance phrase (e.g. "...на кофе и
// завтра купить батарейки"). Deliberately narrow (conjunction + a
// task/reminder-like word) so ordinary multi-item purchases like "кофе
// и печенье" still resolve deterministically as a single expense. When
// this matches, Tier 0 intentionally does NOT claim confidence, even
// though parseFinanceMessage() successfully parsed an amount — the
// message is escalated to the AI tiers instead, which can split it into
// the correct ordered multi-action list.
// Note: no \b word-boundary anchors around the Cyrillic words — JS regex
// \b is defined relative to ASCII \w, so it doesn't reliably bound
// Cyrillic text. Whitespace/start-of-string anchors are used instead.
const MULTI_ACTION_HINT_REGEX =
  /(?:^|\s)и\s+(завтра|послезавтра|потом|ещё|также|напомни|нужно|купить|сделать|позвонить|написать|отправить)(?:\s|$)/i;

const EXACT_SYSTEM_COMMANDS = {
  "привет": "greeting",
  "мои знания": "list_knowledge",
  "мои задачи": "list_active_tasks",
  "выполненные задачи": "list_completed_tasks",
  "баланс": "balance",
  "история": "history",
  "статистика": "statistics",
  "аналитика": "analytics",
  "расходы за сегодня": "expenses_today",
  "расходы за неделю": "expenses_week",
  "расходы за месяц": "expenses_month",
};

const PREFIX_ACTIONS = [
  { prefix: "спроси ", type: "chat" },
  { prefix: "найди ", type: "search" },
  { prefix: "найти ", type: "search" },
  { prefix: "вспомни ", type: "search" },
  { prefix: "выполнено ", type: "system_command" },
  { prefix: "сколько потратил на ", type: "system_command" },
];

function confidentContract(action, reasonCode) {
  return createRoutingContract({
    language: "ru",
    actions: [action],
    reasonCode,
  });
}

/**
 * Attempts to classify `text` using only existing deterministic
 * parsing. Returns a full routing contract (see contracts.js) when
 * confident, or null when the AI tiers should be tried instead.
 *
 * @param {string} text - normalized text (see inputNormalizer.js).
 * @returns {object|null}
 */
export function detectDeterministicIntent(text) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) {
    return confidentContract(
      createAction({ type: "unknown", confidence: 1 }),
      "empty_input"
    );
  }

  // Bare numbers / single punctuation / empty-normalized noise: final
  // Tier-0 decision — never escalate to Tier 1/Tier 2. Legacy router
  // shows the short menu fallback; Memory must not save these.
  if (isMeaninglessShortInput(trimmed)) {
    return confidentContract(
      createAction({ type: "unknown", confidence: 1 }),
      "meaningless_short_input"
    );
  }

  if (isYouTubeLink(trimmed)) {
    return confidentContract(
      createAction({
        type: "knowledge_query",
        confidence: 1,
        payload: { query: trimmed },
      }),
      "youtube_link"
    );
  }

  const normalizedCommand = normalizeCommandText(trimmed);

  // Menu / navigation labels: final Tier-0 decision, never escalate to
  // Tier 1/Tier 2. Execution stays with the Telegram menu handlers —
  // the AI router must not invent Memory/Tasks/Finance for these.
  if (isMenuNavigationCommand(trimmed)) {
    return confidentContract(
      createAction({
        type: "system_command",
        confidence: 1,
        payload: { command: "menu_navigation" },
      }),
      "menu_navigation"
    );
  }

  if (DESTRUCTIVE_TEXT_COMMANDS.includes(normalizedCommand)) {
    return confidentContract(
      createAction({
        type: "system_command",
        confidence: 1,
        payload: { command: "delete_all_knowledge" },
        requiresConfirmation: true,
      }),
      "destructive_command"
    );
  }

  const financeQuery = parseFinanceQuery(trimmed);

  if (financeQuery?.intent === "delete_last") {
    return confidentContract(
      createAction({
        type: "system_command",
        confidence: 1,
        payload: { command: "delete_last_transaction" },
        requiresConfirmation: true,
      }),
      "destructive_command"
    );
  }

  if (financeQuery?.intent) {
    return confidentContract(
      createAction({
        type: "system_command",
        confidence: 1,
        payload: { command: financeQuery.intent },
      }),
      "finance_query_intent"
    );
  }

  const finance = parseFinanceMessage(trimmed);

  if (finance && MULTI_ACTION_HINT_REGEX.test(trimmed)) {
    return null;
  }

  if (finance) {
    return confidentContract(
      createAction({
        type: finance.type === "income" ? "finance_income" : "finance_expense",
        confidence: 1,
        payload: {
          amount: finance.amount,
          currency: finance.currency,
          description: finance.description || null,
        },
      }),
      "finance_parsed"
    );
  }

  const lowerCommand = normalizedCommand in EXACT_SYSTEM_COMMANDS ? normalizedCommand : null;

  if (lowerCommand) {
    return confidentContract(
      createAction({
        type: "system_command",
        confidence: 1,
        payload: { command: EXACT_SYSTEM_COMMANDS[lowerCommand] },
      }),
      "exact_command"
    );
  }

  const lower = trimmed.toLowerCase();

  // Ideas read/search before generic "покажи"/"открыть" knowledge prefixes.
  if (isIdeasRetrievalQuery(trimmed)) {
    return confidentContract(
      createAction({
        type: "chat",
        confidence: 1,
        payload: { query: trimmed, domain: "ideas" },
      }),
      "ideas_query"
    );
  }

  if (isKnowledgeListCommand(trimmed)) {
    return confidentContract(
      createAction({
        type: "knowledge_query",
        confidence: 1,
        payload: { command: "list_knowledge" },
      }),
      "exact_command"
    );
  }

  if (isKnowledgeOpenCommand(trimmed)) {
    return confidentContract(
      createAction({
        type: "knowledge_query",
        confidence: 1,
        payload: { query: trimmed },
      }),
      "prefix_command"
    );
  }

  for (const { prefix, type } of PREFIX_ACTIONS) {
    if (lower.startsWith(prefix)) {
      // Do not claim bare "покажи …" / "открыть …" as knowledge unless
      // it matched isKnowledgeOpenCommand above — otherwise Ideas/Answer
      // (and other routes) never get a chance.
      if (type === "knowledge_query") {
        continue;
      }
      return confidentContract(
        createAction({
          type,
          confidence: 1,
          payload:
            type === "chat" || type === "search"
              ? { query: trimmed.slice(prefix.length).trim() }
              : { command: prefix.trim() },
        }),
        "prefix_command"
      );
    }
  }

  // Finance-like text that failed to parse (e.g. an amount phrase the
  // existing parser still can't resolve) is a clear signal it needs a
  // clarification, without spending an AI call to discover that.
  if (looksLikeFinanceAttempt(trimmed)) {
    return createRoutingContract({
      language: "ru",
      actions: [],
      needsClarification: true,
      clarificationQuestion:
        "Не удалось распознать сумму. Уточните, пожалуйста, сколько и на что?",
      reasonCode: "unparsed_finance_attempt",
    });
  }

  // Strong idea capture patterns — save without forcing a category first.
  if (isStrongIdeaCapture(trimmed)) {
    return confidentContract(
      createAction({
        type: "idea_create",
        confidence: 0.9,
        payload: { content: trimmed },
      }),
      "idea_detected"
    );
  }

  return null;
}
