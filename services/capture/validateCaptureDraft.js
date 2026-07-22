/**
 * Post-merge Capture draft validation / finance dedupe.
 * Pure — no I/O, never logs transcript text.
 */

import { createCaptureDraft } from "./captureContracts.js";

const INTERNAL_TYPE_DESC = /^(finance_expense|finance_income|idea_create|task_create|memory_save|preference|reminder|knowledge_candidate)$/i;

function normalizeDesc(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function financeKey(action) {
  const amount = Number(action?.payload?.amount);
  const currency = String(action?.payload?.currency || "VND").toUpperCase();
  const type = action?.type === "finance_income" ? "income" : "expense";
  const desc = normalizeDesc(
    action?.payload?.description || action?.content || ""
  );
  return `${type}|${amount}|${currency}|${desc.slice(0, 48)}`;
}

function scoreFinance(action) {
  let score = 0;
  const amount = Number(action?.payload?.amount);
  if (Number.isFinite(amount) && amount > 0) score += 10;
  if (action?.payload?.currency) score += 2;
  const desc = normalizeDesc(
    action?.payload?.description || action?.content || ""
  );
  if (desc && !INTERNAL_TYPE_DESC.test(desc)) score += Math.min(desc.length, 20);
  if (typeof action?.confidence === "number") score += action.confidence;
  return score;
}

function isFinance(action) {
  return (
    action?.type === "finance_expense" || action?.type === "finance_income"
  );
}

/**
 * @param {object} draft
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {{ draft: object, removedDuplicates: number, invalidAmounts: number, before: number, after: number }}
 */
export function validateCaptureDraft(draft, options = {}) {
  const log = typeof options.log === "function" ? options.log : null;
  const actions = Array.isArray(draft?.actions) ? draft.actions.slice() : [];
  const before = actions.length;

  let invalidAmounts = 0;
  let removedDuplicates = 0;

  const cleaned = [];
  for (const action of actions) {
    if (!action) continue;

    if (isFinance(action)) {
      const amount = Number(action.payload?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        invalidAmounts += 1;
        continue;
      }
      let description = String(
        action.payload?.description || action.content || ""
      ).trim();
      if (INTERNAL_TYPE_DESC.test(description)) {
        description = "";
      }
      cleaned.push({
        ...action,
        content: description || action.content || "",
        payload: {
          ...(action.payload || {}),
          amount,
          currency: String(action.payload?.currency || "VND").toUpperCase(),
          description,
        },
      });
      continue;
    }

    cleaned.push(action);
  }

  // Collapse duplicate finance by canonical identity; keep highest-score.
  const byKey = new Map();
  const nonFinance = [];
  for (const action of cleaned) {
    if (!isFinance(action)) {
      nonFinance.push(action);
      continue;
    }
    const key = financeKey(action);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, action);
      continue;
    }
    removedDuplicates += 1;
    byKey.set(
      key,
      scoreFinance(action) >= scoreFinance(prev) ? action : prev
    );
  }

  // Also collapse near-duplicates: same type+amount+currency, one empty desc.
  const financeList = [...byKey.values()];
  const collapsed = [];
  for (const action of financeList) {
    const amount = Number(action.payload?.amount);
    const currency = String(action.payload?.currency || "VND").toUpperCase();
    const type = action.type;
    const desc = normalizeDesc(action.payload?.description || action.content);
    const rivalIdx = collapsed.findIndex(
      (a) =>
        a.type === type &&
        Number(a.payload?.amount) === amount &&
        String(a.payload?.currency || "VND").toUpperCase() === currency
    );
    if (rivalIdx < 0) {
      collapsed.push(action);
      continue;
    }
    removedDuplicates += 1;
    const rival = collapsed[rivalIdx];
    const rivalDesc = normalizeDesc(
      rival.payload?.description || rival.content
    );
    // Prefer non-empty meaningful description.
    if ((!rivalDesc || rivalDesc.length < 2) && desc.length >= 2) {
      collapsed[rivalIdx] = action;
    } else if (scoreFinance(action) > scoreFinance(rival)) {
      collapsed[rivalIdx] = action;
    }
  }

  // Drop raw fragment amounts that are exact divisors already represented
  // as a ×1000 version with a better description (75 vs 75000).
  const finalFinance = [];
  for (const action of collapsed) {
    const amount = Number(action.payload?.amount);
    const scaled = collapsed.find(
      (other) =>
        other !== action &&
        other.type === action.type &&
        String(other.payload?.currency || "VND").toUpperCase() ===
          String(action.payload?.currency || "VND").toUpperCase() &&
        Number(other.payload?.amount) === amount * 1000
    );
    if (scaled && amount > 0 && amount < 1000) {
      removedDuplicates += 1;
      continue;
    }
    finalFinance.push(action);
  }

  const nextActions = [...finalFinance, ...nonFinance];
  const next = createCaptureDraft({
    actions: nextActions,
    sourceTier: draft?.sourceTier || "deterministic",
    language: draft?.language || "ru",
    truncated: Boolean(draft?.truncated),
  });

  if (log) {
    log(
      `[capture-validation] before=${before} after=${nextActions.length} removedDuplicates=${removedDuplicates} invalidAmounts=${invalidAmounts}`
    );
  }

  return {
    draft: next,
    removedDuplicates,
    invalidAmounts,
    before,
    after: nextActions.length,
  };
}

/**
 * Client/server shared validation errors for Confirm.
 * @param {object[]} actions
 * @returns {string[]}
 */
export function listCaptureFinanceValidationErrors(actions) {
  const errors = [];
  const list = Array.isArray(actions) ? actions : [];
  list.forEach((action, index) => {
    if (!isFinance(action)) return;
    const n = index + 1;
    const amount = Number(action.payload?.amount);
    const currency = String(action.payload?.currency || "").trim();
    const description = String(
      action.payload?.description || action.content || ""
    ).trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`Пункт ${n}: сумма должна быть больше 0`);
    }
    if (!currency) {
      errors.push(`Пункт ${n}: укажите валюту`);
    }
    if (INTERNAL_TYPE_DESC.test(description)) {
      errors.push(`Пункт ${n}: заполните описание`);
    }
  });

  // Duplicate check
  const seen = new Set();
  for (const action of list) {
    if (!isFinance(action)) continue;
    const key = financeKey(action);
    if (seen.has(key)) {
      errors.push("Есть дубликаты расходов/доходов — удалите лишние");
      break;
    }
    seen.add(key);
  }

  return errors;
}
