/**
 * Telegram boundary for Unified Capture Session + Batch Confirmation.
 */

import { buildCaptureConfirmKeyboard } from "../keyboards/captureKeyboard.js";
import {
  formatCapturePreview,
  handleCaptureSessionTurn,
  maybeStartCaptureSession,
} from "../../services/capture/captureSessionService.js";
import { defaultCaptureSessionStore } from "../../services/capture/captureSessionStore.js";
import { CAPTURE_CALLBACK } from "../../services/capture/captureContracts.js";
import { buildActorFromTelegram } from "../../services/inbox/inboxContracts.js";
import {
  MINI_APP_PATHS,
  withMiniAppOpenButton,
} from "../../config/deepLinks.js";

let botPromise = null;
function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((m) => m.default);
  }
  return botPromise;
}

/**
 * Pending session confirm/edit/cancel (text or callback).
 */
export async function maybeHandleCaptureSessionTurn(input = {}, options = {}) {
  const { chatId, text, from, actor = null, callbackData = null } = input;
  const {
    sendMessageFn = async (c, t, extra) =>
      (await getBot()).sendMessage(c, t, extra),
    store = defaultCaptureSessionStore,
    ...rest
  } = options;

  const resolvedActor = actor || buildActorFromTelegram(from, chatId);
  const actorKey = resolvedActor?.actorKey;
  if (!actorKey) return { handled: false, reason: "missing_actor" };

  // Fast path: no session → skip
  if (!callbackData && !store.get(actorKey, chatId)) {
    return { handled: false, reason: "no_session" };
  }

  const result = await handleCaptureSessionTurn(
    {
      text,
      actorKey,
      chatId,
      callbackData,
      from,
    },
    { store, ...rest }
  );

  if (!result.handled) return result;

  if (result.preview) {
    const sessionId = result.session?.id || store.get(actorKey, chatId)?.id;
    const { reply_markup } = buildCaptureConfirmKeyboard({ sessionId });
    await sendMessageFn(chatId, result.preview, { reply_markup });
    return result;
  }

  if (result.message) {
    const { reply_markup } = withMiniAppOpenButton(
      {},
      MINI_APP_PATHS.home,
      "Open ALMAS →"
    );
    await sendMessageFn(chatId, result.message, { reply_markup });
  }

  return result;
}

/**
 * Create a new capture session when eligible (multi/mixed/long/voice).
 */
export async function maybeHandleCaptureSessionCreate(input = {}, options = {}) {
  const {
    chatId,
    text,
    from,
    actor = null,
    requestKey = null,
    inputSource = "text",
  } = input;

  const {
    sendMessageFn = async (c, t, extra) =>
      (await getBot()).sendMessage(c, t, extra),
    store = defaultCaptureSessionStore,
    useUniversalExtraction = false,
    ...rest
  } = options;

  const resolvedActor = actor || buildActorFromTelegram(from, chatId);
  const actorKey = resolvedActor?.actorKey;
  if (!actorKey) return { handled: false, reason: "missing_actor" };

  const started = await maybeStartCaptureSession(
    {
      text,
      actorKey,
      chatId,
      source: inputSource === "voice" ? "voice" : "text",
      requestKey,
      inputSource,
    },
    { store, useUniversalExtraction, ...rest }
  );

  if (!started.handled || !started.session) return started;

  const preview = formatCapturePreview(started.session);
  const { reply_markup } = buildCaptureConfirmKeyboard({
    sessionId: started.session.id,
  });
  await sendMessageFn(chatId, preview, { reply_markup });

  console.log(
    `[capture] action=start id=${started.session.id} actions=${started.session.draft?.actions?.length || 0} source=${started.session.source}`
  );

  return started;
}

export { CAPTURE_CALLBACK };
