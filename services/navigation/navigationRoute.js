/**
 * Execute resolved navigation actions against existing domain services.
 * Thin orchestration — no new storage.
 */

import { getKnowledgeByIndex, getAllKnowledge } from "../storage/knowledgeService.js";
import {
  getIdeaByListIndex,
  listIdeasExperience,
} from "../ideas/ideaService.js";
import { getActiveTasks } from "../storage/taskService.js";
import { completeTask } from "../storage/taskUpdateService.js";
import {
  getBalance,
  getHistory,
  getExpensesByPeriod,
} from "../finance/financeService.js";
import { defaultNavigationContextStore } from "./navigationContextStore.js";
import { resolveNavigationInput } from "./navigationResolver.js";
import {
  ideasPath,
  MINI_APP_PATHS,
  THIN_CONFIRM,
  thinOpenReply,
} from "../../config/deepLinks.js";

let botPromise = null;
function getBot() {
  if (!botPromise) {
    botPromise = import("../../config/bot.js").then((m) => m.default);
  }
  return botPromise;
}

/**
 * Format a knowledge card (kept for tests / non-Telegram clients).
 * Telegram navigation uses thin deep-links instead.
 * @param {object} knowledge
 * @returns {string}
 */
export function formatKnowledgeCard(knowledge) {
  if (!knowledge) return "❌ Знание не найдено.";
  return `📚 ${knowledge.title}`;
}

/**
 * @param {object} input
 * @param {object} [options]
 * @returns {Promise<{ handled: boolean, reason?: string }>}
 */
export async function maybeHandleNavigation(input = {}, options = {}) {
  const { chatId, text, from, actor = null, userId = null } = input;

  const {
    sendMessageFn = async (c, t, extra) =>
      (await getBot()).sendMessage(c, t, extra),
    store = defaultNavigationContextStore,
    resolveFn = resolveNavigationInput,
    getKnowledgeByIndexFn = getKnowledgeByIndex,
    getAllKnowledgeFn = getAllKnowledge,
    getIdeaByListIndexFn = getIdeaByListIndex,
    listIdeasFn = listIdeasExperience,
    getActiveTasksFn = getActiveTasks,
    completeTaskFn = completeTask,
    getBalanceFn = getBalance,
    getHistoryFn = getHistory,
    getExpensesByPeriodFn = getExpensesByPeriod,
    sendMainMenuFn = null,
  } = options;

  const actorKey =
    actor?.actorKey ||
    (from?.id != null ? `telegram:${from.id}` : null);
  const uid = userId != null ? String(userId) : from?.id != null ? String(from.id) : null;

  if (!actorKey) return { handled: false, reason: "missing_actor" };

  const context = store.get(actorKey, chatId);
  const resolved = resolveFn(text, context);

  if (!resolved.handled || !resolved.action) {
    return { handled: false, reason: resolved.reason || "not_nav" };
  }

  const action = resolved.action;

  try {
    if (action.type === "clear_only") {
      store.clear(actorKey, chatId);
      await sendMessageFn(chatId, "Операция отменена.");
      return { handled: true, reason: "cleared_cancel" };
    }

    if (action.type === "clear_and_home") {
      store.clear(actorKey, chatId);
      if (typeof sendMainMenuFn === "function") {
        await sendMainMenuFn(chatId);
      } else {
        await sendMessageFn(chatId, "🏠 Главная. Выбери раздел в меню 👇");
      }
      return { handled: true, reason: "cleared_home" };
    }

    if (action.type === "show_list") {
      return await showSectionList(action.section, {
        chatId,
        actorKey,
        uid,
        sendMessageFn,
        store,
        getAllKnowledgeFn,
        listIdeasFn,
        getActiveTasksFn,
        getBalanceFn,
        getHistoryFn,
        context,
      });
    }

    if (action.type === "finance_shortcut") {
      return await runFinanceShortcut(action.shortcut, {
        chatId,
        uid,
        sendMessageFn,
        getBalanceFn,
        getHistoryFn,
        getExpensesByPeriodFn,
      });
    }

    if (action.type === "complete_task") {
      const task = await completeTaskFn(action.index);
      if (!task) {
        await sendMessageFn(chatId, "❌ Задача не найдена.");
        return { handled: true, reason: "task_missing" };
      }
      const done = thinOpenReply(
        `✅ Done.\n\n${THIN_CONFIRM.openTasks}`,
        MINI_APP_PATHS.tasks,
        THIN_CONFIRM.openTasks
      );
      await sendMessageFn(chatId, done.text, {
        reply_markup: done.reply_markup,
      });
      return { handled: true, reason: "task_completed" };
    }

    if (action.type === "open") {
      return await openSectionItem(action.section, action.index, {
        chatId,
        actorKey,
        sendMessageFn,
        store,
        context,
        getKnowledgeByIndexFn,
        getIdeaByListIndexFn,
        getActiveTasksFn,
      });
    }

    return { handled: false, reason: "unknown_action" };
  } catch (error) {
    console.error("[nav] handle failed:", error?.message || error);
    return { handled: false, reason: "nav_error" };
  }
}

async function openSectionItem(section, index, deps) {
  const {
    chatId,
    actorKey,
    sendMessageFn,
    store,
    context,
    getKnowledgeByIndexFn,
    getIdeaByListIndexFn,
    getActiveTasksFn,
  } = deps;

  async function sendThin(text, path, label) {
    const reply = thinOpenReply(text, path, label);
    await sendMessageFn(chatId, reply.text, {
      reply_markup: reply.reply_markup,
    });
  }

  if (section === "knowledge") {
    const mapped = mapContextIndex(context, index);
    const openIndex = mapped?.index ?? index;
    const knowledge = await getKnowledgeByIndexFn(openIndex);
    if (!knowledge) {
      await sendMessageFn(chatId, "❌ Знание не найдено.");
      return { handled: true, reason: "knowledge_missing" };
    }
    await sendThin(
      `📚 Knowledge ready.\n\n${THIN_CONFIRM.openKnowledge}`,
      MINI_APP_PATHS.knowledge,
      THIN_CONFIRM.openKnowledge
    );
    keepNavigationContextAfterOpen(store, actorKey, chatId, {
      section: "knowledge",
      cursor: openIndex,
      items: context?.items,
    });
    return { handled: true, reason: "knowledge_opened" };
  }

  if (section === "ideas") {
    const { idea, index: idx, total } = await getIdeaByListIndexFn(
      actorKey,
      index
    );
    if (!idea) {
      await sendMessageFn(
        chatId,
        total === 0
          ? "💡 У тебя пока нет сохранённых идей."
          : `❌ Идея ${index} не найдена.`
      );
      return { handled: true, reason: "idea_missing" };
    }
    await sendThin(
      `💡 Idea ready.\n\n${THIN_CONFIRM.openIdeas}`,
      ideasPath(idea.id),
      THIN_CONFIRM.openIdeas
    );
    keepNavigationContextAfterOpen(store, actorKey, chatId, {
      section: "ideas",
      cursor: idx,
      items: context?.items,
    });
    return { handled: true, reason: "idea_opened" };
  }

  if (section === "tasks") {
    const tasks = await getActiveTasksFn();
    const task = tasks[index - 1];
    if (!task) {
      await sendMessageFn(chatId, "❌ Задача не найдена.");
      return { handled: true, reason: "task_missing" };
    }
    await sendThin(
      `📋 Task ready.\n\n${THIN_CONFIRM.openTasks}`,
      MINI_APP_PATHS.tasks,
      THIN_CONFIRM.openTasks
    );
    keepNavigationContextAfterOpen(store, actorKey, chatId, {
      section: "tasks",
      cursor: index,
      items: context?.items,
    });
    return { handled: true, reason: "task_opened" };
  }

  if (section === "memory") {
    const item =
      context?.items?.find((i) => i.index === index) ||
      context?.items?.[index - 1];
    if (!item?.content) {
      await sendMessageFn(chatId, "❌ Запись памяти не найдена.");
      return { handled: true, reason: "memory_missing" };
    }
    await sendThin(
      `🧠 Memory ready.\n\n${THIN_CONFIRM.openMemory}`,
      MINI_APP_PATHS.memory,
      THIN_CONFIRM.openMemory
    );
    keepNavigationContextAfterOpen(store, actorKey, chatId, {
      section: "memory",
      cursor: index,
      items: context?.items,
    });
    return { handled: true, reason: "memory_opened" };
  }

  return { handled: false, reason: "unsupported_section" };
}

function mapContextIndex(context, index) {
  if (!context?.items?.length) return null;
  return context.items.find((i) => i.index === index) || null;
}

async function showSectionList(section, deps) {
  const {
    chatId,
    actorKey,
    sendMessageFn,
    store,
    getAllKnowledgeFn,
    listIdeasFn,
    getActiveTasksFn,
  } = deps;

  async function sendThin(text, path, label) {
    const reply = thinOpenReply(text, path, label);
    await sendMessageFn(chatId, reply.text, {
      reply_markup: reply.reply_markup,
    });
  }

  if (section === "knowledge") {
    const knowledge = await getAllKnowledgeFn();
    const latest = knowledge.slice(0, 10);
    const items = latest.map((item, i) => ({
      index: i + 1,
      id: item.id ?? null,
      title: item.title,
    }));
    await sendThin(
      latest.length
        ? `📚 ${latest.length} knowledge items found.\n\n${THIN_CONFIRM.openKnowledge}`
        : `📚 Knowledge\n\n${THIN_CONFIRM.openKnowledge}`,
      MINI_APP_PATHS.knowledge,
      THIN_CONFIRM.openKnowledge
    );
    store.set(actorKey, chatId, {
      section: "knowledge",
      screen: "list",
      items,
      cursor: null,
    });
    return {
      handled: true,
      reason: latest.length ? "knowledge_list" : "knowledge_list_empty",
    };
  }

  if (section === "ideas") {
    const page = await listIdeasFn(actorKey, { pageSize: 10 });
    const total = page.total ?? (page.ideas || []).length;
    await sendThin(
      total === 0
        ? `💡 No ideas yet.\n\n${THIN_CONFIRM.openIdeas}`
        : `💡 ${total} ideas found.\n\n${THIN_CONFIRM.openIdeas}`,
      MINI_APP_PATHS.ideas,
      THIN_CONFIRM.openIdeas
    );
    store.set(actorKey, chatId, {
      section: "ideas",
      screen: "list",
      items: (page.ideas || []).map((idea, i) => ({
        index: i + 1,
        id: idea.id ?? null,
        title: idea.title || idea.normalizedText,
      })),
      cursor: null,
    });
    return { handled: true, reason: "ideas_list" };
  }

  if (section === "tasks") {
    const tasks = await getActiveTasksFn();
    const items = tasks.slice(0, 20).map((task, i) => ({
      index: i + 1,
      id: task.id ?? null,
      content: task.content,
    }));
    await sendThin(
      `📋 Tasks\n\n${THIN_CONFIRM.openTasks}`,
      MINI_APP_PATHS.tasks,
      THIN_CONFIRM.openTasks
    );
    store.set(actorKey, chatId, {
      section: "tasks",
      screen: "list",
      items,
      cursor: null,
    });
    return {
      handled: true,
      reason: tasks.length ? "tasks_list" : "tasks_list_empty",
    };
  }

  if (section === "memory") {
    await sendThin(
      `🧠 Memory\n\n${THIN_CONFIRM.openMemory}`,
      MINI_APP_PATHS.memory,
      THIN_CONFIRM.openMemory
    );
    return { handled: true, reason: "memory_list_hint" };
  }

  if (section === "finance") {
    await sendThin(
      `💰 Finance\n\n${THIN_CONFIRM.openFinance}`,
      MINI_APP_PATHS.finance,
      THIN_CONFIRM.openFinance
    );
    store.set(actorKey, chatId, {
      section: "finance",
      screen: "summary",
      items: [],
    });
    return { handled: true, reason: "finance_list" };
  }

  return { handled: false, reason: "show_list_unsupported" };
}

async function runFinanceShortcut(_shortcut, deps) {
  const { chatId, sendMessageFn } = deps;
  const reply = thinOpenReply(
    `💰 Finance\n\n${THIN_CONFIRM.openFinance}`,
    MINI_APP_PATHS.finance,
    THIN_CONFIRM.openFinance
  );
  await sendMessageFn(chatId, reply.text, {
    reply_markup: reply.reply_markup,
  });
  return { handled: true, reason: "finance_shortcut" };
}

/**
 * Helper for menu routes to publish a list context.
 */
export function setNavigationListContext(
  store,
  actorKey,
  chatId,
  section,
  items,
  extra = {}
) {
  if (!store || !actorKey) return null;
  return store.set(actorKey, chatId, {
    section,
    screen: "list",
    items,
    cursor: null,
    ...extra,
  });
}

/**
 * After a successful item open: keep the same section active.
 * Uses set() (not update) so exact-command opens without a prior list
 * still create a live context. Never calls sendMainMenu.
 */
export function keepNavigationContextAfterOpen(
  store,
  actorKey,
  chatId,
  { section, cursor, items } = {}
) {
  if (!store || !actorKey || !section) return null;
  const current = typeof store.peek === "function"
    ? store.peek(actorKey, chatId)
    : store.get(actorKey, chatId);
  return store.set(actorKey, chatId, {
    section,
    screen: "item",
    cursor: cursor ?? current?.cursor ?? null,
    items: items ?? current?.items ?? [],
    page: current?.page ?? 0,
    meta: current?.meta ?? {},
  });
}
