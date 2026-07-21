/**
 * Capture Session orchestration — create / confirm / cancel / edit.
 */

import { buildCaptureDraft } from "./captureDraftBuilder.js";
import { shouldCreateCaptureSession } from "./captureEligibility.js";
import { executeCaptureBatch } from "./captureBatchExecutor.js";
import {
  formatCaptureConfirmResult,
  formatCapturePreview,
} from "./capturePreview.js";
import {
  parseCaptureControlText,
  CAPTURE_CALLBACK,
} from "./captureContracts.js";
import { defaultCaptureSessionStore } from "./captureSessionStore.js";

/**
 * @param {object} input
 * @param {object} [options]
 * @returns {Promise<{ handled: boolean, session?: object, reason?: string }>}
 */
export async function maybeStartCaptureSession(input = {}, options = {}) {
  const {
    text,
    actorKey,
    chatId,
    source = "text",
    requestKey = null,
    inputSource = "text",
  } = input;

  const {
    store = defaultCaptureSessionStore,
    buildDraftFn = buildCaptureDraft,
    shouldCreateFn = shouldCreateCaptureSession,
    useUniversalExtraction = false,
  } = options;

  if (!actorKey || !String(text ?? "").trim()) {
    return { handled: false, reason: "missing_input" };
  }

  // Do not start a new session while one is pending.
  if (store.get(actorKey, chatId)) {
    return { handled: false, reason: "session_already_pending" };
  }

  const draft = await buildDraftFn(text, {
    useUniversalExtraction,
    inputSource: inputSource || source,
    allowDefaultProvider: options.allowDefaultProvider === true,
    forceAi: options.forceAi === true,
  });

  if (!shouldCreateFn(text, draft, { inputSource: inputSource || source })) {
    return { handled: false, reason: "not_eligible", draft };
  }

  const session = await store.create({
    actorKey,
    chatId,
    source: inputSource === "voice" ? "voice" : source,
    originalText: text,
    draft,
    requestKey,
  });

  return { handled: true, session, reason: "started" };
}

/**
 * Handle confirm / edit / cancel for an active session.
 * @param {object} input
 * @param {object} [options]
 */
export async function handleCaptureSessionTurn(input = {}, options = {}) {
  const {
    text,
    actorKey,
    chatId,
    callbackData = null,
    from = null,
  } = input;

  const {
    store = defaultCaptureSessionStore,
    executeFn = executeCaptureBatch,
    buildDraftFn = buildCaptureDraft,
  } = options;

  if (!actorKey) return { handled: false, reason: "missing_actor" };

  const session = store.get(actorKey, chatId);
  if (!session) return { handled: false, reason: "no_session" };

  let control = null;
  if (callbackData === CAPTURE_CALLBACK.confirm) control = "confirm";
  else if (callbackData === CAPTURE_CALLBACK.edit) control = "edit";
  else if (callbackData === CAPTURE_CALLBACK.cancel) control = "cancel";
  else control = parseCaptureControlText(text);

  // Editing mode: next free-text rebuilds the draft.
  if (!control && session.status === "editing" && String(text ?? "").trim()) {
    const draft = await buildDraftFn(text, {
      useUniversalExtraction: options.useUniversalExtraction === true,
      inputSource: session.source,
    });
    const updated = await store.update(actorKey, chatId, {
      status: "pending",
      originalText: text,
      draft,
      refreshTtl: true,
    });
    return {
      handled: true,
      reason: "edited",
      session: updated,
      preview: formatCapturePreview(updated),
    };
  }

  if (!control) {
    return { handled: false, reason: "not_control" };
  }

  if (control === "cancel") {
    await store.clear(actorKey, chatId, "cancelled");
    return { handled: true, reason: "cancelled", message: "❌ Отменено. Ничего не сохранено." };
  }

  if (control === "edit") {
    await store.update(actorKey, chatId, { status: "editing", refreshTtl: true });
    return {
      handled: true,
      reason: "awaiting_edit",
      message:
        "✏️ Пришлите исправленный текст одним сообщением — я пересоберу черновик.",
    };
  }

  if (control === "confirm") {
    if (store.hasExecuted(session.id)) {
      await store.clear(actorKey, chatId, "confirmed");
      return {
        handled: true,
        reason: "already_executed",
        message: "✅ Уже сохранено ранее.",
      };
    }

    const execution = await executeFn(
      session,
      {
        actorKey,
        chatId,
        userId: from?.id ?? null,
        telegramUserId: from?.id ?? null,
      },
      options.executorDeps || {}
    );

    store.markExecuted(session.id);
    await store.clear(actorKey, chatId, "confirmed");

    return {
      handled: true,
      reason: "confirmed",
      execution,
      message: formatCaptureConfirmResult(execution),
    };
  }

  return { handled: false, reason: "unknown_control" };
}

export { formatCapturePreview, formatCaptureConfirmResult };
