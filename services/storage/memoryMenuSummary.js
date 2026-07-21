/**
 * Memory main-menu summary — actor-scoped, quality-filtered, deduped.
 * Pure helpers + thin orchestration for Telegram menuRoute.
 */

import { normalizeMemoryFactContent } from "../storage/memoryFilter.js";
import { isUserFact } from "../answer/memoryQuality.js";
import {
  isFinanceLikeMemory,
  isTaskMemoryRow,
} from "../answer/memoryIntentFilter.js";
import { normalizeEvidenceText } from "../answer/evidenceDedupe.js";

export const MEMORY_MENU_LIMIT = 8;

/**
 * Filter + normalize + dedupe raw memory rows for the Memory menu.
 * @param {object[]} rows
 * @param {object} [opts]
 * @returns {{ content: string }[]}
 */
export function prepareMemoryMenuItems(rows, opts = {}) {
  const limit = Math.min(
    Math.max(Number(opts.limit) || MEMORY_MENU_LIMIT, 1),
    20
  );
  const seen = new Set();
  const out = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = row?.content ?? row?.text ?? "";
    const content = normalizeMemoryFactContent(raw);
    if (!content) continue;
    if (!isUserFact(content)) continue;
    if (isTaskMemoryRow(row, content)) continue;
    if (isFinanceLikeMemory(content)) continue;

    const key = normalizeEvidenceText(content);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: row?.id ?? null,
      content,
      createdAt: row?.created_at ?? row?.createdAt ?? null,
    });
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Telegram text for the Memory main-menu entry.
 * @param {object} input
 * @param {{ content: string }[]} input.items
 * @returns {string}
 */
export function formatMemoryMenuSummary(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];

  if (!items.length) {
    return [
      "🧠 Пока ничего не запомнено.",
      "",
      "Напишите:",
      "«Запомни, что...»",
    ].join("\n");
  }

  const lines = ["🧠 Память", "", "Последние записи:", ""];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.content}`);
  });
  return lines.join("\n");
}
