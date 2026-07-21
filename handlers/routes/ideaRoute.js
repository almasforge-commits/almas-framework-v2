/**
 * Ideas Telegram route — capture, dedicated read experience, category callbacks.
 */

import {
  buildIdeaConfirmationMessage,
  captureIdea,
} from "../../services/ideas/ideaCapture.js";
import {
  classifyIdeasReadIntent,
} from "../../services/ideas/ideaQueryIntent.js";
import {
  getIdeaByListIndex,
  listIdeasExperience,
  searchIdeas,
  updateIdeaCategory,
} from "../../services/ideas/ideaService.js";
import { detectIdea, STRONG_IDEA_CONFIDENCE } from "../../services/ideas/ideaDetector.js";
import {
  ideaCategoryLabelRu,
  isIdeaCategory,
} from "../../services/ideas/ideaContracts.js";
import { buildActorFromTelegram } from "../../services/inbox/inboxContracts.js";
import { defaultNavigationContextStore } from "../../services/navigation/navigationContextStore.js";
import {
  keepNavigationContextAfterOpen,
  setNavigationListContext,
} from "../../services/navigation/navigationRoute.js";
import {
  ideasPath,
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

/**
 * Dedicated Ideas list / open / search experience.
 * Runs before Answer Engine so Ideas are not collapsed into prose.
 *
 * @returns {Promise<{ handled: boolean, reason?: string, intent?: object }>}
 */
export async function maybeHandleIdeasExperience(input = {}, options = {}) {
  const { chatId, text, from, actor = null } = input;

  const {
    sendMessageFn = async (c, t, extra) =>
      (await getBot()).sendMessage(c, t, extra),
    classifyFn = classifyIdeasReadIntent,
    listFn = listIdeasExperience,
    getByIndexFn = getIdeaByListIndex,
    searchFn = searchIdeas,
    navigationStore = defaultNavigationContextStore,
  } = options;

  const intent = classifyFn(text);
  if (!intent?.kind) {
    return { handled: false, reason: "not_ideas_read" };
  }

  const resolvedActor = actor || buildActorFromTelegram(from, chatId);
  const actorKey = resolvedActor?.actorKey;
  if (!actorKey) return { handled: false, reason: "missing_actor" };

  try {
    if (intent.kind === "list") {
      const page = await listFn(actorKey, {});
      const total = page.total ?? (page.ideas || []).length;
      const reply = thinOpenReply(
        total === 0
          ? "💡 No ideas yet.\n\nOpen Ideas →"
          : `💡 ${total} ideas found.\n\nOpen Ideas →`,
        MINI_APP_PATHS.ideas,
        THIN_CONFIRM.openIdeas
      );
      await sendMessageFn(chatId, reply.text, {
        reply_markup: reply.reply_markup,
      });
      setNavigationListContext(
        navigationStore,
        actorKey,
        chatId,
        "ideas",
        (page.ideas || []).map((idea, i) => ({
          index: i + 1,
          id: idea.id ?? null,
          title: idea.title || idea.normalizedText || null,
        }))
      );
      console.log(
        `[ideas] action=list total=${page.total} shown=${page.ideas.length} ok=true`
      );
      return { handled: true, reason: "ideas_list", intent };
    }

    if (intent.kind === "open") {
      const { idea, index, total } = await getByIndexFn(actorKey, intent.index);
      if (!idea) {
        await sendMessageFn(
          chatId,
          total === 0
            ? "💡 У тебя пока нет сохранённых идей."
            : `❌ Идея ${intent.index} не найдена. У тебя ${total} ${total === 1 ? "идея" : "идей"}.`
        );
        return { handled: true, reason: "ideas_open_missing", intent };
      }

      const reply = thinOpenReply(
        `💡 Idea ready.\n\nOpen Ideas →`,
        ideasPath(idea.id),
        THIN_CONFIRM.openIdeas
      );
      await sendMessageFn(chatId, reply.text, {
        reply_markup: reply.reply_markup,
      });
      keepNavigationContextAfterOpen(navigationStore, actorKey, chatId, {
        section: "ideas",
        cursor: index,
      });
      console.log(
        `[ideas] action=open index=${index} id=${idea.id} ok=true`
      );
      return { handled: true, reason: "ideas_open", intent };
    }

    if (intent.kind === "search") {
      const matches = await searchFn(intent.query, {
        actorKey,
        category: intent.category || undefined,
        limit: 12,
      });
      const reply = thinOpenReply(
        matches.length === 0
          ? "💡 Nothing found.\n\nOpen Ideas →"
          : `💡 ${matches.length} ideas found.\n\nOpen Ideas →`,
        MINI_APP_PATHS.ideas,
        THIN_CONFIRM.openIdeas
      );
      await sendMessageFn(chatId, reply.text, {
        reply_markup: reply.reply_markup,
      });
      console.log(
        `[ideas] action=search category=${intent.category || "any"} matches=${matches.length} ok=true`
      );
      return { handled: true, reason: "ideas_search", intent };
    }

    return { handled: false, reason: "unknown_ideas_kind", intent };
  } catch (error) {
    console.error("[ideas] experience failed:", error?.message || error);
    return { handled: false, reason: "ideas_experience_error" };
  }
}

/**
 * Capture an idea outside AI-router active execution (shadow / legacy path).
 * Never throws.
 *
 * @returns {Promise<{ handled: boolean, idea?: object }>}
 */
export async function maybeCaptureIdea(input = {}, options = {}) {
  const {
    chatId,
    text,
    from,
    actor = null,
    inputSource = "text",
  } = input;

  const {
    sendMessageFn = async (c, t, extra) =>
      (await getBot()).sendMessage(c, t, extra),
    captureIdeaFn = captureIdea,
    detectIdeaFn = detectIdea,
    skipAi = false,
  } = options;

  const detection = detectIdeaFn(text);
  if (!detection.isIdea) {
    return { handled: false, reason: detection.reason };
  }

  const requireStrong = options.requireStrong !== false;
  if (requireStrong && detection.confidence < STRONG_IDEA_CONFIDENCE) {
    return { handled: false, reason: "soft_idea_deferred" };
  }

  const resolvedActor = actor || buildActorFromTelegram(from, chatId);
  const actorKey = resolvedActor?.actorKey;
  if (!actorKey) return { handled: false, reason: "missing_actor" };

  try {
    const result = await captureIdeaFn({
      text,
      detection,
      actorKey,
      telegramUserId: from?.id,
      chatId,
      source: inputSource === "voice" ? "voice" : "text",
      skipAi,
      origin: "telegram_capture",
    });

    if (!result?.ok || !result.idea) {
      return { handled: false, reason: result?.reason || "persist_failed" };
    }

    const confirmation = buildIdeaConfirmationMessage(result.idea);
    await sendMessageFn(chatId, confirmation.text, {
      reply_markup: confirmation.reply_markup,
    });

    return { handled: true, idea: result.idea };
  } catch (error) {
    console.error("[ideas] capture failed:", error?.message || error);
    return { handled: false, reason: "capture_error" };
  }
}

/**
 * Handle idea:cat:<id>:<category> callbacks.
 * @returns {Promise<boolean>} whether this callback was an idea category update
 */
export async function handleIdeaCategoryCallback(query, options = {}) {
  const data = String(query?.data ?? "");
  const match = /^idea:cat:([0-9a-f-]{36}):([a-z]+)$/i.exec(data);
  if (!match) return false;

  const ideaId = match[1];
  const category = match[2].toLowerCase();
  if (!isIdeaCategory(category)) return true;

  const {
    sendMessageFn = async (c, t) => (await getBot()).sendMessage(c, t),
    answerCallbackQueryFn = async (id, opts) =>
      (await getBot()).answerCallbackQuery(id, opts),
    updateIdeaCategoryFn = updateIdeaCategory,
    editMessageFn = async (chatId, messageId, text, extra) =>
      (await getBot()).editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...extra,
      }),
  } = options;

  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  const from = query?.from;
  const actor = buildActorFromTelegram(from, chatId);
  const actorKey = actor?.actorKey;

  try {
    const updated = actorKey
      ? await updateIdeaCategoryFn(ideaId, actorKey, category)
      : null;

    if (updated) {
      const confirmation = buildIdeaConfirmationMessage(updated);
      if (chatId != null && messageId != null) {
        await editMessageFn(chatId, messageId, confirmation.text, {
          reply_markup: confirmation.reply_markup,
        }).catch(async () => {
          await sendMessageFn(
            chatId,
            `Категория обновлена: ${ideaCategoryLabelRu(category)}`
          );
        });
      }
      await answerCallbackQueryFn(query.id, {
        text: `Категория: ${ideaCategoryLabelRu(category)}`,
      }).catch(() => {});
    } else {
      await answerCallbackQueryFn(query.id, {
        text: "Не удалось обновить категорию",
        show_alert: true,
      }).catch(() => {});
    }
  } catch (error) {
    console.error("[ideas] category callback failed:", error?.message || error);
    await answerCallbackQueryFn(query.id).catch(() => {});
  }

  return true;
}
