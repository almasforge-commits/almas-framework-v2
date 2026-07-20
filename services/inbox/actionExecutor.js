import { saveMemory } from "../storage/memoryService.js";
import { classifyMemory } from "../storage/memoryClassifier.js";

// The ONLY module in the AI router pipeline allowed to import a domain-
// executing service. providers/ai/*, aiIntentAnalyzer.js, actionPlanner.js,
// actionValidator.js, deterministicIntentDetector.js, and
// routingDecisionService.js must never import Finance/Memory/Tasks/
// Knowledge directly — everything flows through this boundary instead,
// and only after actionValidator.js has already approved an action.
//
// Currently whitelisted for real execution: task_create, memory_save.
// Both persist through the same saveMemory() call — Tasks still live
// inside the `memories` table (see DATA_MODEL.md / D-003), so
// task_create sets memoryType: "task" directly instead of re-deriving
// it via memoryClassifier's keyword heuristics: the AI already decided
// this is a task, ALMAS trusts that classification rather than
// re-guessing from keywords.
//
// Finance, system_command (including every destructive command),
// knowledge_query, search, chat, and unknown are never executed here —
// deterministic Finance parsing remains the sole authority for money
// movement, and every other type is explicitly out of scope for this
// milestone (see PROJECT_STATE.md).

export const EXECUTABLE_ACTION_TYPES = ["task_create", "memory_save"];

// Cross-call idempotency: guards against the SAME Telegram message being
// executed twice (e.g. a retried/duplicated update), on top of the
// within-one-call `seenSignatures` dedup below (which only protects
// against the AI planning the identical action more than once in a
// single response). Keyed by context.requestKey (see
// core/utils/buildRequestKey.js) — in-memory only, so a process restart
// resets it; bounded so a long-running process can't leak memory.
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
    // Precise reason: validator already folded title/text → content, so
    // reaching here means every supported alias was genuinely empty.
    return { executed: false, reason: "skipped_missing_task_content", type: "task_create" };
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
    return { executed: false, reason: "skipped_missing_memory_content", type: "memory_save" };
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

/**
 * Executes already-validated actions (see actionValidator.js) for ONE
 * incoming message, preserving their original order. Never throws — a
 * failure in one action is recorded and execution continues with the
 * next one; a domain-service failure never crashes routing.
 *
 * @param {object[]} actions - validated actions (contracts.js shape).
 * @param {{ mode: "shadow"|"active", chatId?: *, userId?: *, username?: string|null, firstName?: string|null, requestKey?: string|null }} context
 * @param {object} [deps] - injected for tests; defaults to the real services.
 * @param {Function} [deps.saveMemoryFn]
 * @param {Function} [deps.classifyMemoryFn]
 * @returns {Promise<{ results: object[], executedCount: number, skippedCount: number }>}
 */
export async function executeActions(actions, context = {}, deps = {}) {
  const { saveMemoryFn = saveMemory, classifyMemoryFn = classifyMemory } = deps;

  const results = [];
  const seenSignatures = new Set();

  for (const action of Array.isArray(actions) ? actions : []) {
    // Defense in depth: actionValidator.js already forces this on
    // destructive actions and blocks voice-destructive outright — this
    // second check guarantees the executor itself can never run an
    // action still pending explicit user confirmation, regardless of
    // how it got here.
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
      outcome =
        action.type === "task_create"
          ? await runTaskCreate(action, context, { saveMemoryFn })
          : await runMemorySave(action, context, { saveMemoryFn, classifyMemoryFn });
    } catch (error) {
      outcome = { executed: false, reason: "domain_error", type: action.type };
    }

    if (outcome.executed) {
      rememberExecutedForRequest(context.requestKey, signature);
    }

    results.push({ action, ...outcome });
  }

  const executedCount = results.filter((result) => result.executed).length;

  return { results, executedCount, skippedCount: results.length - executedCount };
}
