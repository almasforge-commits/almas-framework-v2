/**
 * Execute a confirmed Capture draft via existing domain services.
 * No duplicated finance/idea/memory/task business logic.
 */

import { randomUUID } from "node:crypto";
import { addExpense, addIncome } from "../finance/financeService.js";
import { resolveFinanceCategory } from "../finance/categorizer.js";
import { captureIdea } from "../ideas/ideaCapture.js";
import { saveMemory } from "../storage/memoryService.js";
import { classifyMemory } from "../storage/memoryClassifier.js";

/**
 * @param {object} session
 * @param {object} [context]
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
export async function executeCaptureBatch(session, context = {}, deps = {}) {
  const {
    addExpenseFn = addExpense,
    addIncomeFn = addIncome,
    captureIdeaFn = captureIdea,
    saveMemoryFn = saveMemory,
    classifyMemoryFn = classifyMemory,
  } = deps;

  const actions = Array.isArray(session?.draft?.actions)
    ? session.draft.actions
    : [];
  const userId =
    context.userId != null
      ? String(context.userId)
      : context.telegramUserId != null
        ? String(context.telegramUserId)
        : null;
  const actorKey = session?.actorKey || context.actorKey;
  const batchId = randomUUID();
  const results = [];
  const seen = new Set();

  for (const action of actions) {
    const sig = `${action.type}|${action.content}|${action.payload?.amount ?? ""}`;
    if (seen.has(sig)) {
      results.push({
        action,
        executed: false,
        reason: "skipped_duplicate",
      });
      continue;
    }
    seen.add(sig);

    try {
      if (action.type === "finance_expense") {
        const amount = Number(action.payload?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          results.push({ action, executed: false, reason: "missing_amount" });
          continue;
        }
        const saved = await addExpenseFn({
          amount,
          category: resolveFinanceCategory({
            category: action.payload?.category,
            description: action.payload?.description || action.content || "",
            type: "expense",
          }),
          description: action.payload?.description || action.content || "",
          currency: action.payload?.currency || "VND",
          user_id: userId,
          batch_id: batchId,
        });
        if (!saved) {
          results.push({
            action,
            executed: false,
            reason: "finance_persist_failed",
          });
          continue;
        }
        results.push({ action, executed: true, reason: "ok", id: saved.id });
        continue;
      }

      if (action.type === "finance_income") {
        const amount = Number(action.payload?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          results.push({ action, executed: false, reason: "missing_amount" });
          continue;
        }
        const saved = await addIncomeFn({
          amount,
          category: resolveFinanceCategory({
            category: action.payload?.category,
            description: action.payload?.description || action.content || "",
            type: "income",
          }),
          description: action.payload?.description || action.content || "",
          currency: action.payload?.currency || "VND",
          user_id: userId,
          batch_id: batchId,
        });
        if (!saved) {
          results.push({
            action,
            executed: false,
            reason: "finance_persist_failed",
          });
          continue;
        }
        results.push({ action, executed: true, reason: "ok", id: saved.id });
        continue;
      }

      if (action.type === "idea_create") {
        const content = String(
          action.payload?.content || action.content || ""
        ).trim();
        if (!content) {
          results.push({ action, executed: false, reason: "missing_content" });
          continue;
        }
        // Capture Review already classified this entity — do not re-run AI.
        const captured = await captureIdeaFn({
          text: content,
          content,
          actorKey,
          telegramUserId: userId,
          chatId: session.chatId ?? context.chatId,
          source: session.source === "voice" ? "voice" : "text",
          confidence: action.confidence,
          category: action.payload?.category || null,
          tags: action.payload?.tags || null,
          skipAi: deps.skipIdeaAi !== false,
          skipRelated: deps.skipIdeaRelated === true,
          origin: "capture_session",
        });
        results.push({
          action,
          executed: Boolean(captured?.ok),
          reason: captured?.ok ? "ok" : captured?.reason || "idea_failed",
          idea: captured?.idea,
        });
        continue;
      }

      if (
        action.type === "memory_save" ||
        action.type === "preference"
      ) {
        const content = String(
          action.payload?.content || action.content || ""
        ).trim();
        if (!content) {
          results.push({ action, executed: false, reason: "missing_content" });
          continue;
        }
        const memory = classifyMemoryFn(content);
        const ok = await saveMemoryFn({
          source: "telegram",
          type: "message",
          content,
          metadata: {
            ...memory,
            userId,
            chatId: session.chatId ?? context.chatId,
            actorKey,
            memoryType:
              action.type === "preference" ? "preference" : "note",
            captureSessionId: session.id,
            actionType: "memory_save",
          },
        });
        results.push({
          action,
          executed: Boolean(ok),
          reason: ok ? "ok" : "memory_failed",
        });
        continue;
      }

      if (action.type === "task_create" || action.type === "reminder") {
        const content = String(
          action.payload?.content || action.content || ""
        ).trim();
        if (!content) {
          results.push({ action, executed: false, reason: "missing_content" });
          continue;
        }
        const ok = await saveMemoryFn({
          source: "telegram",
          type: "message",
          content,
          metadata: {
            memoryType: "task",
            status: "active",
            actionType: "task_create",
            userId,
            chatId: session.chatId ?? context.chatId,
            actorKey,
            dueDateText: action.payload?.dueDateText || null,
            captureSessionId: session.id,
          },
        });
        results.push({
          action,
          executed: Boolean(ok),
          reason: ok ? "ok" : "task_failed",
        });
        continue;
      }

      if (action.type === "knowledge_candidate") {
        // v1: do not auto-write Knowledge (high-risk). Keep as skipped.
        results.push({
          action,
          executed: false,
          reason: "skipped_knowledge_candidate",
        });
        continue;
      }

      results.push({
        action,
        executed: false,
        reason: "unsupported_type",
      });
    } catch (error) {
      results.push({
        action,
        executed: false,
        reason: "domain_error",
        error: error?.message || String(error),
      });
    }
  }

  const executedCount = results.filter((r) => r.executed).length;
  return {
    results,
    executedCount,
    skippedCount: results.length - executedCount,
    batchId,
  };
}
