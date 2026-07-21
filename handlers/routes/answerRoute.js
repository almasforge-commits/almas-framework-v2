/**
 * Telegram read-only Answer Engine route.
 * Never writes Finance/Tasks/Memory/Inbox. Execution always none.
 */

import { classifyAnswerRouteIntent } from "../../services/answer/answerQuestionGate.js";
import { createTelegramAnswerEngineWithWorld } from "../../services/answer/telegramAnswerFactory.js";
import { EXECUTION_NONE } from "../../services/answer/answerContracts.js";
import {
  MINI_APP_PATHS,
  THIN_CONFIRM,
  thinOpenReply,
} from "../../config/deepLinks.js";

let botPromise = null;

function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((mod) => mod.default);
  }
  return botPromise;
}

const defaultSendMessageFn = async (chatId, text, extra) =>
  (await getBot()).sendMessage(chatId, text, extra);

/**
 * If the message is a genuine information question, answer via Answer Engine.
 *
 * @param {object} input
 * @param {object} [options] — fully injectable
 * @returns {Promise<{ handled: boolean, reason?: string, result?: object }>}
 */
export async function maybeHandleAnswerQuestion(input = {}, options = {}) {
  const {
    chatId,
    text,
    from = null,
    actor = null,
  } = input;

  const {
    sendMessageFn = defaultSendMessageFn,
    classifyFn = classifyAnswerRouteIntent,
    /** Async or sync. Default resolves World Knowledge (default-off) then Answer Engine. */
    createEngineFn = createTelegramAnswerEngineWithWorld,
    answerEngine = null,
    engineOverrides = {},
  } = options;

  const classification = classifyFn(text);
  if (!classification.useAnswerEngine) {
    return { handled: false, reason: classification.reason };
  }

  const actorKey =
    actor?.actorKey ||
    (from?.id != null ? `telegram:${from.id}` : null);

  if (!actorKey) {
    return { handled: false, reason: "missing_actor" };
  }

  const query = classification.query || String(text ?? "").trim();
  if (!query) {
    await safeSend(sendMessageFn, chatId, "❌ Напиши вопрос.");
    return { handled: true, reason: "empty_query" };
  }

  try {
    const resolved = await resolveAnswerEngine(
      answerEngine,
      createEngineFn,
      engineOverrides
    );
    const engine = resolved.engine;
    const result = await engine.answer({
      actorKey,
      chatId: chatId != null ? String(chatId) : null,
      query,
    });

    // Hard safety: never allow non-none execution from this path.
    if (!result.execution || result.execution.type !== "none") {
      result.execution = EXECUTION_NONE;
    }

    const reply = thinAnswerReply(result);
    await safeSend(sendMessageFn, chatId, reply.text, {
      reply_markup: reply.reply_markup,
    });

    return {
      handled: true,
      reason: "answered",
      result,
      classification,
      worldKnowledgeMode: resolved.worldKnowledge?.mode ?? null,
    };
  } catch {
    console.log("[answer] telegram read-only path failed");
    await safeSend(sendMessageFn, chatId, "Пока я этого не знаю.");
    return { handled: true, reason: "answer_failed" };
  }
}

async function safeSend(sendMessageFn, chatId, text, extra) {
  try {
    await sendMessageFn(chatId, text, extra);
  } catch {
    // never throw into routeText
  }
}

function thinAnswerReply(result) {
  const answer = String(result?.answer || "").trim();
  const found =
    Boolean(answer) &&
    !/^пока я этого не знаю/i.test(answer) &&
    result?.needsClarification !== true;

  if (!found) {
    return thinOpenReply(
      `${THIN_CONFIRM.notFound}\n\n${THIN_CONFIRM.openAlmas}`,
      MINI_APP_PATHS.home
    );
  }

  return thinOpenReply(
    `${THIN_CONFIRM.found}\n\nOpen in ALMAS →`,
    MINI_APP_PATHS.home,
    "Open in ALMAS →"
  );
}

/**
 * Accept prebuilt engine, sync createTelegramAnswerEngine, or async WithWorld bundle.
 */
async function resolveAnswerEngine(answerEngine, createEngineFn, engineOverrides) {
  if (answerEngine && typeof answerEngine.answer === "function") {
    return { engine: answerEngine, worldKnowledge: null };
  }
  const created = await createEngineFn(engineOverrides);
  if (created && typeof created.answer === "function") {
    return { engine: created, worldKnowledge: null };
  }
  return {
    engine: created.engine,
    worldKnowledge: created.worldKnowledge ?? null,
  };
}
