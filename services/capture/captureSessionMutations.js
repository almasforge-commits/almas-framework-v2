/**
 * Capture Session draft mutations for Mini App review (before write).
 * Reuses capture store + batch executor — no domain logic duplication.
 */

import { executeCaptureBatch } from "./captureBatchExecutor.js";
import { formatCaptureDraftDetail } from "./capturePreview.js";
import { defaultCaptureSessionStore } from "./captureSessionStore.js";
import {
  listCaptureFinanceValidationErrors,
  validateCaptureDraft,
} from "./validateCaptureDraft.js";
import { createCaptureDraft } from "./captureContracts.js";

/**
 * Replace draft actions for a pending session (actor-scoped by id).
 * @param {string} sessionId
 * @param {string} actorKey
 * @param {object[]} actions
 * @param {object} [options]
 */
export async function patchCaptureSessionActions(
  sessionId,
  actorKey,
  actions,
  options = {}
) {
  const store = options.store || defaultCaptureSessionStore;
  const session =
    typeof store.ensureLoaded === "function"
      ? await store.ensureLoaded(sessionId, actorKey)
      : store.getById(sessionId, actorKey);
  if (!session) {
    return { ok: false, reason: "not_found" };
  }
  if (session.status !== "pending" && session.status !== "editing") {
    return { ok: false, reason: "not_editable", status: session.status };
  }
  if (!Array.isArray(actions)) {
    return { ok: false, reason: "invalid_actions" };
  }

  const nextActions = actions
    .filter((a) => a && typeof a === "object" && a.type)
    .map((a) => ({
      type: String(a.type),
      confidence:
        typeof a.confidence === "number" && Number.isFinite(a.confidence)
          ? a.confidence
          : 0.8,
      payload:
        a.payload && typeof a.payload === "object" ? { ...a.payload } : {},
      requiresConfirmation: a.requiresConfirmation !== false,
      content: a.content,
    }));

  const validated = validateCaptureDraft(
    createCaptureDraft({
      actions: nextActions,
      sourceTier: session.draft?.sourceTier || "deterministic",
      language: session.draft?.language || "ru",
    }),
    { log: (line) => console.log(line) }
  );

  const draft = {
    ...(session.draft || {}),
    actions: validated.draft.actions,
    source: session.draft?.source || "mini_app_edit",
  };

  const updated = await store.update(session.actorKey, session.chatId, {
    draft,
    status: "pending",
    refreshTtl: true,
  });

  if (!updated) {
    return { ok: false, reason: "update_failed" };
  }

  return {
    ok: true,
    session: updated,
    detail: formatCaptureDraftDetail(updated),
  };
}

/**
 * Confirm + execute batch for a session by id (Mini App).
 * @param {string} sessionId
 * @param {object} actor - { actorKey, telegramUserId }
 * @param {object} [options]
 */
export async function confirmCaptureSessionById(
  sessionId,
  actor,
  options = {}
) {
  const store = options.store || defaultCaptureSessionStore;
  const executeFn = options.executeFn || executeCaptureBatch;
  const actorKey = actor?.actorKey;
  if (!actorKey) return { ok: false, reason: "missing_actor" };

  const session =
    typeof store.ensureLoaded === "function"
      ? await store.ensureLoaded(sessionId, actorKey)
      : store.getById(sessionId, actorKey);
  if (!session) {
    // Idempotent confirm after clear: treat known executed ids as success.
    if (store.hasExecuted?.(sessionId)) {
      return { ok: true, reason: "already_executed", executedCount: 0 };
    }
    return { ok: false, reason: "not_found" };
  }

  if (store.hasExecuted(session.id)) {
    if (session.status === "pending" || session.status === "editing") {
      await store.clear(session.actorKey, session.chatId, "confirmed");
    }
    return { ok: true, reason: "already_executed", executedCount: 0 };
  }

  if (session.status !== "pending" && session.status !== "editing") {
    return { ok: false, reason: "not_pending", status: session.status };
  }

  const draftActions = Array.isArray(session?.draft?.actions)
    ? session.draft.actions
    : [];
  const validationErrors = listCaptureFinanceValidationErrors(draftActions);
  if (validationErrors.length > 0) {
    return {
      ok: false,
      reason: "validation_failed",
      validationErrors,
      executedCount: 0,
    };
  }

  const execution = await executeFn(
    session,
    {
      actorKey,
      chatId: session.chatId,
      userId: actor.telegramUserId ?? actor.userId ?? null,
      telegramUserId: actor.telegramUserId ?? actor.userId ?? null,
    },
    options.executorDeps || {}
  );

  const actions = Array.isArray(session?.draft?.actions)
    ? session.draft.actions
    : [];
  const attempted = (execution?.results || []).filter(
    (r) =>
      r?.reason !== "skipped_duplicate" &&
      r?.reason !== "skipped_knowledge_candidate" &&
      r?.reason !== "unsupported_type"
  );
  const executedCount = execution?.executedCount ?? 0;

  if (attempted.length > 0 && executedCount === 0) {
    return {
      ok: false,
      reason: "persist_failed",
      execution,
      executedCount: 0,
    };
  }

  store.markExecuted(session.id);
  await store.clear(session.actorKey, session.chatId, "confirmed");

  return {
    ok: true,
    reason: "confirmed",
    execution,
    executedCount,
  };
}

/**
 * Cancel a pending session by id.
 */
export async function cancelCaptureSessionById(
  sessionId,
  actorKey,
  options = {}
) {
  const store = options.store || defaultCaptureSessionStore;
  const session =
    typeof store.ensureLoaded === "function"
      ? await store.ensureLoaded(sessionId, actorKey)
      : store.getById(sessionId, actorKey);
  if (!session) return { ok: false, reason: "not_found" };
  await store.clear(session.actorKey, session.chatId, "cancelled");
  return { ok: true, reason: "cancelled" };
}
