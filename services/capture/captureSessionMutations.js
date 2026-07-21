/**
 * Capture Session draft mutations for Mini App review (before write).
 * Reuses capture store + batch executor — no domain logic duplication.
 */

import { executeCaptureBatch } from "./captureBatchExecutor.js";
import { formatCaptureDraftDetail } from "./capturePreview.js";
import { defaultCaptureSessionStore } from "./captureSessionStore.js";

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

  const draft = {
    ...(session.draft || {}),
    actions: nextActions,
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
  if (!session) return { ok: false, reason: "not_found" };
  if (session.status !== "pending" && session.status !== "editing") {
    return { ok: false, reason: "not_pending", status: session.status };
  }

  if (store.hasExecuted(session.id)) {
    await store.clear(session.actorKey, session.chatId, "confirmed");
    return { ok: true, reason: "already_executed", executedCount: 0 };
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

  store.markExecuted(session.id);
  await store.clear(session.actorKey, session.chatId, "confirmed");

  return {
    ok: true,
    reason: "confirmed",
    execution,
    executedCount: execution?.executedCount ?? 0,
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
