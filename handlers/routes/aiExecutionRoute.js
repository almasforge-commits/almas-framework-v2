// Rendering boundary for AI-router active-mode execution results.
// services/inbox/actionExecutor.js stays Telegram-independent.

import { buildIdeaConfirmationMessage } from "../../services/ideas/ideaCapture.js";
import {
  MINI_APP_PATHS,
  THIN_CONFIRM,
  withMiniAppOpenButton,
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
 * @param {{ action: object, executed: boolean, reason: string, idea?: object }} result
 * @returns {string|{ text: string, reply_markup?: object }|null}
 */
export function formatAiExecutionConfirmation(result) {
  const action = result?.action;

  if (!action) return null;

  if (action.type === "task_create") {
    return {
      text: `${THIN_CONFIRM.task}\n\n${THIN_CONFIRM.openTasks}`,
      reply_markup: withMiniAppOpenButton(
        {},
        MINI_APP_PATHS.tasks,
        THIN_CONFIRM.openTasks
      ).reply_markup,
    };
  }

  if (action.type === "memory_save") {
    return {
      text: `${THIN_CONFIRM.memory}\n\n${THIN_CONFIRM.openMemory}`,
      reply_markup: withMiniAppOpenButton(
        {},
        MINI_APP_PATHS.memory,
        THIN_CONFIRM.openMemory
      ).reply_markup,
    };
  }

  if (action.type === "idea_create") {
    const idea = result.idea;
    if (idea?.id) {
      return buildIdeaConfirmationMessage(idea);
    }
    return {
      text: `${THIN_CONFIRM.idea}\n\n${THIN_CONFIRM.openIdeas}`,
      reply_markup: withMiniAppOpenButton(
        {},
        MINI_APP_PATHS.ideas,
        THIN_CONFIRM.openIdeas
      ).reply_markup,
    };
  }

  return null;
}

/**
 * @param {object[]} executedActions
 * @returns {Array<string|{ text: string, reply_markup?: object }>}
 */
export function formatAiExecutionConfirmations(executedActions) {
  return (Array.isArray(executedActions) ? executedActions : [])
    .map(formatAiExecutionConfirmation)
    .filter((text) => Boolean(text));
}

/**
 * @param {number|string} chatId
 * @param {object[]} executedActions
 * @param {object} [options]
 * @returns {Promise<number>}
 */
export async function sendAiExecutionConfirmations(
  chatId,
  executedActions,
  options = {}
) {
  const { sendMessageFn = defaultSendMessageFn } = options;

  const messages = formatAiExecutionConfirmations(executedActions);

  let sentCount = 0;

  for (const message of messages) {
    try {
      if (typeof message === "string") {
        await sendMessageFn(chatId, message);
      } else {
        await sendMessageFn(chatId, message.text, {
          reply_markup: message.reply_markup,
        });
      }
      sentCount += 1;
    } catch (error) {
      console.error(
        "[ai-router] failed to send an execution confirmation:",
        error?.message || error
      );
    }
  }

  return sentCount;
}
