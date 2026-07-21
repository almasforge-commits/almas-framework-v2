/**
 * Format Capture Session preview for Telegram (thin) and Mini App (detail).
 */

import { THIN_CONFIRM } from "../../config/deepLinks.js";

function groupActions(actions) {
  const groups = {
    finance_expense: [],
    finance_income: [],
    idea_create: [],
    task_create: [],
    reminder: [],
    memory_save: [],
    preference: [],
    knowledge_candidate: [],
  };
  for (const action of Array.isArray(actions) ? actions : []) {
    if (groups[action.type]) groups[action.type].push(action);
    else if (action.type === "preference") groups.preference.push(action);
  }
  return groups;
}

/**
 * Counts-only summary for Telegram (no long cards).
 * @param {object} session
 * @returns {string}
 */
export function formatCapturePreview(session) {
  const draft = session?.draft || {};
  const actions = Array.isArray(draft.actions) ? draft.actions : [];
  if (!actions.length) {
    return "📥 Не удалось выделить действия из сообщения.";
  }

  const groups = groupActions(actions);
  const lines = [THIN_CONFIRM.captureReady, ""];

  const expenseN = groups.finance_expense.length;
  const incomeN = groups.finance_income.length;
  const ideaN = groups.idea_create.length;
  const taskN = groups.task_create.length + groups.reminder.length;
  const memoryN = groups.memory_save.length + groups.preference.length;
  const knowledgeN = groups.knowledge_candidate.length;

  if (expenseN) lines.push(`• Expenses ×${expenseN}`);
  if (incomeN) lines.push(`• Income ×${incomeN}`);
  if (ideaN) lines.push(`• Idea ×${ideaN}`);
  if (taskN) lines.push(`• Task ×${taskN}`);
  if (memoryN) lines.push(`• Memory ×${memoryN}`);
  if (knowledgeN) lines.push(`• Knowledge ×${knowledgeN}`);

  lines.push("", "Review →");
  return lines.join("\n");
}

/**
 * Full draft detail for Mini App / API (not sent in Telegram).
 * @param {object} session
 * @returns {object}
 */
export function formatCaptureDraftDetail(session) {
  const draft = session?.draft || {};
  const rawActions = Array.isArray(draft.actions) ? draft.actions : [];
  const actions = rawActions.map((action, index) => ({
    ...action,
    index,
  }));
  const groups = groupActions(actions);
  return {
    sessionId: session?.id ?? null,
    status: session?.status ?? null,
    source: session?.source ?? null,
    originalText: session?.originalText ?? "",
    counts: {
      expenses: groups.finance_expense.length,
      income: groups.finance_income.length,
      ideas: groups.idea_create.length,
      tasks: groups.task_create.length + groups.reminder.length,
      memory: groups.memory_save.length + groups.preference.length,
      knowledge: groups.knowledge_candidate.length,
      total: actions.length,
    },
    actions,
    groups: {
      expenses: groups.finance_expense,
      income: groups.finance_income,
      ideas: groups.idea_create,
      tasks: [...groups.task_create, ...groups.reminder],
      memory: [...groups.memory_save, ...groups.preference],
      knowledge: groups.knowledge_candidate,
    },
    expiresAt: session?.expiresAt ?? null,
    createdAt: session?.createdAt ?? null,
  };
}

/**
 * Short post-confirm summary for Telegram.
 * @param {object} execution
 * @returns {string}
 */
export function formatCaptureConfirmResult(execution = {}) {
  const saved = Number(execution.executedCount) || 0;
  if (saved === 0) {
    return "⚠️ Ничего не сохранено.";
  }
  return `${THIN_CONFIRM.captureSaved}\n\n${THIN_CONFIRM.openAlmas}`;
}
