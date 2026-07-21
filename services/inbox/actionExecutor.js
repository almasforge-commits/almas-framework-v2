import { saveMemory } from "../storage/memoryService.js";
import { classifyMemory } from "../storage/memoryClassifier.js";
import { captureIdea } from "../ideas/ideaCapture.js";

// The ONLY module in the AI router pipeline allowed to import a domain-
// executing service. Whitelisted: task_create, memory_save, idea_create.
// Tasks/memories share `memories`; Ideas persist in dedicated `ideas`.

export const EXECUTABLE_ACTION_TYPES = [
  "task_create",
  "memory_save",
  "idea_create",
];

const MAX_IDEMPOTENCY_KEYS = 500;
const executedSignaturesByRequestKey = new Map();

function hasAlreadyExecutedForRequest(requestKey, signature) {
  if (!requestKey) return false;
  return executedSignaturesByRequestKey.get(requestKey)?.has(signature) ?? false;
}

function rememberExecutedForRequest(requestKey, signature) {
  if (!requestKey) return;

  let signatures = executedSignaturesByRequestKey.get(requestKey);

  if (!signatures) {
    signatures = new Set();
    executedSignaturesByRequestKey.set(requestKey, signatures);

    if (executedSignaturesByRequestKey.size > MAX_IDEMPOTENCY_KEYS) {
      const oldestKey = executedSignaturesByRequestKey.keys().next().value;
      executedSignaturesByRequestKey.delete(oldestKey);
    }
  }

  signatures.add(signature);
}

/** Test-only: clears the in-memory idempotency cache between test cases. */
export function resetExecutionIdempotencyCacheForTests() {
  executedSignaturesByRequestKey.clear();
}

function actionSignature(action) {
  return `${action.type}::${JSON.stringify(action.payload ?? {})}`;
}

function reasonForUnexecutedType(type) {
  if (type === "finance_expense" || type === "finance_income") {
    return "skipped_finance_not_enabled";
  }
  return "skipped_not_enabled";
}

async function runTaskCreate(action, context, deps) {
  const content = action.payload?.content;

  if (!content) {
    return {
      executed: false,
      reason: "skipped_missing_task_content",
      type: "task_create",
    };
  }

  const ok = await deps.saveMemoryFn({
    source: "telegram",
    type: "message",
    content,
    metadata: {
      memoryType: "task",
      importance: 8,
      status: "active",
      tags: [],
      chatId: context.chatId ?? null,
      userId: context.userId ?? null,
      username: context.username ?? null,
      firstName: context.firstName ?? null,
      origin: "ai_router",
      actionType: "task_create",
    },
  });

  return ok
    ? { executed: true, reason: "task_created", type: "task_create" }
    : { executed: false, reason: "domain_error", type: "task_create" };
}

async function runMemorySave(action, context, deps) {
  const content = action.payload?.content;

  if (!content) {
    return {
      executed: false,
      reason: "skipped_missing_memory_content",
      type: "memory_save",
    };
  }

  const classified = deps.classifyMemoryFn(content);

  const ok = await deps.saveMemoryFn({
    source: "telegram",
    type: "message",
    content,
    metadata: {
      memoryType: classified.memoryType,
      importance: classified.importance,
      status: classified.status,
      tags: classified.tags,
      chatId: context.chatId ?? null,
      userId: context.userId ?? null,
      username: context.username ?? null,
      firstName: context.firstName ?? null,
      origin: "ai_router",
      actionType: "memory_save",
    },
  });

  return ok
    ? { executed: true, reason: "memory_saved", type: "memory_save" }
    : { executed: false, reason: "domain_error", type: "memory_save" };
}

async function runIdeaCreate(action, context, deps) {
  const content = action.payload?.content;
  if (!content) {
    return {
      executed: false,
      reason: "skipped_missing_idea_content",
      type: "idea_create",
    };
  }

  const userId = context.userId;
  const actorKey =
    context.actorKey ||
    (userId != null ? `telegram:${userId}` : null);

  if (!actorKey) {
    return {
      executed: false,
      reason: "skipped_missing_actor",
      type: "idea_create",
    };
  }

  const captureFn = deps.captureIdeaFn || captureIdea;
  const result = await captureFn({
    text: content,
    actorKey,
    telegramUserId: userId,
    chatId: context.chatId,
    source: context.inputSource === "voice" ? "voice" : "text",
    category: action.payload?.category,
    tags: action.payload?.tags,
    confidence: action.confidence,
    skipAi: deps.skipIdeaAi === true,
    origin: "ai_router",
  });

  if (!result?.ok || !result.idea) {
    return {
      executed: false,
      reason: result?.reason || "domain_error",
      type: "idea_create",
    };
  }

  return {
    executed: true,
    reason: "idea_created",
    type: "idea_create",
    idea: result.idea,
  };
}

/**
 * Executes already-validated actions for ONE incoming message.
 */
export async function executeActions(actions, context = {}, deps = {}) {
  const {
    saveMemoryFn = saveMemory,
    classifyMemoryFn = classifyMemory,
    captureIdeaFn,
    skipIdeaAi,
  } = deps;

  const results = [];
  const seenSignatures = new Set();

  for (const action of Array.isArray(actions) ? actions : []) {
    if (action.requiresConfirmation) {
      results.push({
        action,
        executed: false,
        reason: "skipped_requires_confirmation",
        type: action.type,
      });
      continue;
    }

    if (context.mode !== "active") {
      results.push({
        action,
        executed: false,
        reason: "skipped_shadow_mode",
        type: action.type,
      });
      continue;
    }

    if (!EXECUTABLE_ACTION_TYPES.includes(action.type)) {
      results.push({
        action,
        executed: false,
        reason: reasonForUnexecutedType(action.type),
        type: action.type,
      });
      continue;
    }

    const signature = actionSignature(action);

    if (seenSignatures.has(signature)) {
      results.push({
        action,
        executed: false,
        reason: "skipped_duplicate",
        type: action.type,
      });
      continue;
    }

    if (hasAlreadyExecutedForRequest(context.requestKey, signature)) {
      results.push({
        action,
        executed: false,
        reason: "skipped_duplicate_request",
        type: action.type,
      });
      continue;
    }

    seenSignatures.add(signature);

    let outcome;

    try {
      if (action.type === "task_create") {
        outcome = await runTaskCreate(action, context, { saveMemoryFn });
      } else if (action.type === "memory_save") {
        outcome = await runMemorySave(action, context, {
          saveMemoryFn,
          classifyMemoryFn,
        });
      } else if (action.type === "idea_create") {
        outcome = await runIdeaCreate(action, context, {
          captureIdeaFn,
          skipIdeaAi,
        });
      } else {
        outcome = {
          executed: false,
          reason: reasonForUnexecutedType(action.type),
          type: action.type,
        };
      }
    } catch {
      outcome = { executed: false, reason: "domain_error", type: action.type };
    }

    if (outcome.executed) {
      rememberExecutedForRequest(context.requestKey, signature);
    }

    results.push({ action, ...outcome });
  }

  const executedCount = results.filter((result) => result.executed).length;

  return {
    results,
    executedCount,
    skippedCount: results.length - executedCount,
  };
}
