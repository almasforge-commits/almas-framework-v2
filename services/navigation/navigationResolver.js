/**
 * Resolve Telegram follow-ups and exact domain open commands.
 * Pure string → action; no I/O.
 */

import { isNavigationContextActive } from "./navigationContracts.js";

/**
 * Normalize for matching (lowercase, strip ?!).
 * @param {string} text
 * @returns {string}
 */
export function normalizeNavText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[?！؟]/gu, " ")
    .replace(/[.!…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Explicit domain open commands (work with or without context).
 * Never ambiguous finance amounts.
 *
 * @param {string} text
 * @returns {{ type: string, section: string, index: number }|null}
 */
export function parseExactDomainCommand(text) {
  const n = normalizeNavText(text);
  if (!n) return null;

  const patterns = [
    {
      re: /^(?:открой|открыть|покажи|показать)\s+знание\s+(\d+)$/u,
      section: "knowledge",
    },
    { re: /^знание\s+(\d+)$/u, section: "knowledge" },
    {
      re: /^(?:открой|открыть|покажи|показать)\s+идею\s+(\d+)$/u,
      section: "ideas",
    },
    { re: /^идея\s+(\d+)$/u, section: "ideas" },
    {
      re: /^(?:открой|открыть|покажи|показать)\s+задачу\s+(\d+)$/u,
      section: "tasks",
    },
    { re: /^задача\s+(\d+)$/u, section: "tasks" },
    {
      re: /^(?:открой|открыть|покажи|показать)\s+память\s+(\d+)$/u,
      section: "memory",
    },
    { re: /^память\s+(\d+)$/u, section: "memory" },
  ];

  for (const { re, section } of patterns) {
    const m = re.exec(n);
    if (!m) continue;
    const index = Number(m[1]);
    if (!Number.isFinite(index) || index < 1) continue;
    return { type: "open", section, index, source: "exact_command" };
  }

  return null;
}

/**
 * Whether text must never be saved as Memory (nav / domain opens).
 * @param {string} text
 * @returns {boolean}
 */
export function isNavigationOrDomainOpenCommand(text) {
  if (parseExactDomainCommand(text)) return true;
  const n = normalizeNavText(text);
  if (!n) return false;

  if (
    /^(назад|список|следующее|следующая|следующий|предыдущее|предыдущая|предыдущий|отмена|главная)$/u.test(
      n
    ) ||
    /^🏠\s*главная$/u.test(n)
  ) {
    return true;
  }

  // Context-relative opens: открыть 4 / покажи 4 / открой 4
  if (/^(?:открой|открыть|покажи|показать)\s+(\d+)$/u.test(n)) return true;

  // Bare number alone is not a "command" for memory filter when meaningless —
  // but when it looks like "открыть знание" fragments:
  if (/^(?:открой|открыть|покажи|показать)\s+/u.test(n)) return true;

  return false;
}

/**
 * Finance shortcuts only when finance section is active.
 * @param {string} text
 * @returns {string|null} finance intent key
 */
export function parseFinanceNavShortcut(text) {
  const n = normalizeNavText(text);
  const map = {
    баланс: "balance",
    история: "history",
    неделя: "week",
    месяц: "month",
    доходы: "income",
    расходы: "expenses",
  };
  return map[n] || null;
}

/**
 * Resolve user text against optional active navigation context.
 *
 * @param {string} text
 * @param {object|null} context
 * @param {object} [opts]
 * @returns {{ handled: boolean, action: object|null, reason: string }}
 */
export function resolveNavigationInput(text, context = null, opts = {}) {
  const trimmed = String(text ?? "").trim();
  const n = normalizeNavText(trimmed);
  const nowMs = opts.nowMs ?? Date.now();
  const active = isNavigationContextActive(context, nowMs) ? context : null;

  if (!n) {
    return { handled: false, action: null, reason: "empty" };
  }

  // Cancel clears context; home clears + main menu.
  // Exact match only — never after a successful item open.
  if (n === "отмена") {
    return {
      handled: true,
      action: { type: "clear_only", source: "nav_control" },
      reason: "cancel",
    };
  }
  if (n === "главная" || /^🏠\s*главная$/u.test(n)) {
    return {
      handled: true,
      action: { type: "clear_and_home", source: "nav_control" },
      reason: "home",
    };
  }

  // Exact domain commands beat everything (including Memory).
  const exact = parseExactDomainCommand(trimmed);
  if (exact) {
    return {
      handled: true,
      action: exact,
      reason: "exact_domain_command",
    };
  }

  if (!active) {
    return { handled: false, action: null, reason: "no_active_context" };
  }

  // Section controls
  if (n === "список" || n === "назад") {
    return {
      handled: true,
      action: {
        type: "show_list",
        section: active.section,
        source: "nav_control",
      },
      reason: "list_or_back",
    };
  }

  if (
    n === "следующее" ||
    n === "следующая" ||
    n === "следующий" ||
    n === "предыдущее" ||
    n === "предыдущая" ||
    n === "предыдущий"
  ) {
    if (active.section !== "knowledge" && active.section !== "ideas") {
      return {
        handled: false,
        action: null,
        reason: "next_prev_unsupported_section",
      };
    }
    const delta =
      n === "следующее" || n === "следующая" || n === "следующий" ? 1 : -1;
    const cursor =
      Number.isFinite(Number(active.cursor)) && Number(active.cursor) >= 1
        ? Number(active.cursor)
        : 1;
    const nextIndex = cursor + delta;
    return {
      handled: true,
      action: {
        type: "open",
        section: active.section,
        index: nextIndex,
        source: "nav_step",
        delta,
      },
      reason: "next_or_prev",
    };
  }

  // Finance shortcuts (never bare numbers)
  if (active.section === "finance") {
    const fin = parseFinanceNavShortcut(trimmed);
    if (fin) {
      return {
        handled: true,
        action: {
          type: "finance_shortcut",
          section: "finance",
          shortcut: fin,
          source: "nav_finance",
        },
        reason: "finance_shortcut",
      };
    }
    // Bare numbers are NOT finance actions
    if (/^[\d\s]+$/u.test(n) && /\d/u.test(n)) {
      return {
        handled: false,
        action: null,
        reason: "bare_number_ignored_in_finance",
      };
    }
  }

  // Task completion only in tasks context; otherwise leave for Tasks route.
  const openRel = parseContextRelativeOpen(n);
  if (openRel != null) {
    if (active.section === "finance") {
      return {
        handled: false,
        action: null,
        reason: "bare_number_ignored_in_finance",
      };
    }
    if (openRel.complete && active.section !== "tasks") {
      return {
        handled: false,
        action: null,
        reason: "complete_outside_tasks_context",
      };
    }
    return {
      handled: true,
      action: {
        type: openRel.complete ? "complete_task" : "open",
        section: active.section,
        index: openRel.index,
        source: "nav_context",
      },
      reason: "context_open",
    };
  }

  return { handled: false, action: null, reason: "unrecognized_in_context" };
}

/**
 * @param {string} n normalized
 * @returns {{ index: number, complete?: boolean }|null}
 */
function parseContextRelativeOpen(n) {
  let m = /^(?:открой|открыть|покажи|показать)\s+(\d+)$/u.exec(n);
  if (m) {
    const index = Number(m[1]);
    if (Number.isFinite(index) && index >= 1) return { index };
  }

  m = /^выполнено\s+(\d+)$/u.exec(n);
  if (m) {
    const index = Number(m[1]);
    if (Number.isFinite(index) && index >= 1) {
      return { index, complete: true };
    }
  }

  // Bare number
  if (/^\d+$/u.test(n)) {
    const index = Number(n);
    if (Number.isFinite(index) && index >= 1) return { index };
  }

  return null;
}

/**
 * True when bare numeric input should not hit meaningless fallback
 * because an active non-finance context exists.
 */
export function shouldDeferMeaninglessForNav(text, context, nowMs = Date.now()) {
  if (!isNavigationContextActive(context, nowMs)) return false;
  if (context.section === "finance") return false;
  const trimmed = String(text ?? "").trim();
  return /^[\d\s]+$/u.test(trimmed) && /\d/u.test(trimmed);
}
