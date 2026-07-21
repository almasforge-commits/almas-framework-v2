import bot from "../config/bot.js";
import {
  parseFinanceMessage,
  looksLikeFinanceAttempt,
} from "../services/finance/financeParser.js";
import { normalizeCommandText } from "../core/utils/normalizeCommandText.js";
import { normalizeUserText } from "../core/utils/normalizeUserText.js";
import { isMeaninglessShortInput } from "../core/utils/isMeaninglessShortInput.js";

import {
  addExpense,
  addIncome,
  getBalance,
  getHistory,
  getStatistics,
  getCategoryExpenses,
  getExpensesByPeriod,
  getFinanceAnalytics,
} from "../services/finance/financeService.js";
import { parseFinanceMessages } from "../services/finance/financeMultiParser.js";
import { parseFinanceQuery } from "../services/finance/financeQueryParser.js";
import crypto from "crypto";
import { detectCategory } from "../services/finance/categorizer.js";
import { handleFinanceQuery } from "./routes/financeRoute.js";
import { isYouTubeLink } from "../services/content/youtubeService.js";

import {
  getAllKnowledge,
  getKnowledgeByIndex,
  deleteAllKnowledge,
} from "../services/storage/knowledgeService.js";

import { handleYouTube } from "./routes/youtubeRoute.js";
import { handleVoiceMessage } from "./routes/voiceRoute.js";

import { saveMemory } from "../services/storage/memoryService.js";

import { classifyMemory } from "../services/storage/memoryClassifier.js";
import { shouldSaveMemory, extractLegacyMemorySaveContent } from "../services/storage/memoryFilter.js";

import {
  getActiveTasks,
  getCompletedTasks,
} from "../services/storage/taskService.js";

import { completeTask } from "../services/storage/taskUpdateService.js";

import {
  observeMessage,
  decideRouting,
  getExecutedOwnedActions,
} from "../services/inbox/routingDecisionService.js";
import { isAiRouterExecutionActive } from "../config/aiRouter.js";
import { buildRequestKey } from "../core/utils/buildRequestKey.js";
import { buildActorFromTelegram } from "../services/inbox/inboxContracts.js";
import {
  mapInputSourceToInboxSourceType,
  startInboxReceivedObservation,
} from "../services/inbox/inboxObservation.js";
import { sendAiExecutionConfirmations } from "./routes/aiExecutionRoute.js";
import { maybeCaptureIdea, maybeHandleIdeasExperience } from "./routes/ideaRoute.js";
import {
  isKnowledgeListCommand,
  isKnowledgeOpenCommand,
  extractKnowledgeIndex,
} from "../services/ideas/ideaQueryIntent.js";
import {
  handleClarificationTurn,
  maybeStartClarificationFromAiDecision,
  maybeStartClarificationFromFinanceAttempt,
} from "./routes/clarificationRoute.js";
import { maybeHandleAnswerQuestion } from "./routes/answerRoute.js";
import {
  maybeHandleNavigation,
  keepNavigationContextAfterOpen,
} from "../services/navigation/navigationRoute.js";
import { defaultNavigationContextStore } from "../services/navigation/navigationContextStore.js";
import { shouldDeferMeaninglessForNav } from "../services/navigation/navigationResolver.js";
import {
  maybeHandleCaptureSessionCreate,
  maybeHandleCaptureSessionTurn,
} from "./routes/captureRoute.js";
import {
  MINI_APP_PATHS,
  THIN_CONFIRM,
  withMiniAppOpenButton,
  thinOpenReply,
} from "../config/deepLinks.js";

import {
  sendMainMenu,
  sendFallback,
  sendKnowledgeMenu,
  sendTasksMenu,
  sendFinanceMenu,
  sendMemoryMenu,
  sendIdeasMenu,
  sendIdeasPlaceholder,
  sendProjectsPlaceholder,
  sendOpenAlmas,
  sendHelp,
} from "./routes/menuRoute.js";

// Destructive text commands/intents that permanently delete data. Voice
// input is blocked from triggering these for now (see routeText below);
// typed text is unaffected.
const VOICE_BLOCKED_TEXT_COMMANDS = ["удалить все знания"];
const VOICE_BLOCKED_FINANCE_INTENTS = ["delete_last"];
const VOICE_DESTRUCTIVE_BLOCKED_MESSAGE =
  "⚠️ Опасные команды голосом пока не выполняются. Отправьте команду текстом.";

/**
 * Routes a single piece of already-resolved text (typed or transcribed from
 * voice) through every existing command/intent handler. This is the same
 * logic that used to live inline inside the `bot.on("message", ...)`
 * listener — moved verbatim, with `msg.from` renamed to `from`, so typed
 * text behavior remains byte-for-byte identical.
 *
 * @param {number|string} chatId
 * @param {string} text
 * @param {object} from - msg.from from node-telegram-bot-api.
 * @param {object} [options]
 * @param {"text"|"voice"} [options.inputSource] - Defaults to "text".
 */
export async function routeText(chatId, text, from, options = {}) {

  const { inputSource = "text", messageId = null } = options;

  // Used for command/safety matching only — trim, collapse whitespace,
  // strip trailing punctuation, lowercase. Never used to extract command
  // arguments (those keep reading from the original `text`).
  const normalizedText = normalizeCommandText(text);

  // Navigation menu fast path — MUST run before any AI routing call.
  // Menu labels (/start, "меню", section buttons) must never reach
  // Tier 1/Tier 2, never create Memory/Tasks/Finance, and never produce
  // AI actions. Ideas/Memory open real actor-scoped lists.
  const menuActor = buildActorFromTelegram(from, chatId);
  const menuHandler = {
    "меню": () =>
      sendMainMenu(chatId, { actorKey: menuActor?.actorKey }),
    "/start": () =>
      sendMainMenu(chatId, { actorKey: menuActor?.actorKey }),
    "🏠 главная": () =>
      sendMainMenu(chatId, { actorKey: menuActor?.actorKey }),
    "📚 знания": () =>
      sendKnowledgeMenu(chatId, { actorKey: menuActor?.actorKey }),
    "💡 идеи": () =>
      sendIdeasMenu(chatId, {
        actorKey: menuActor?.actorKey,
        userId: from?.id,
      }),
    "📋 задачи": () =>
      sendTasksMenu(chatId, { actorKey: menuActor?.actorKey }),
    "🚀 проекты": () => sendProjectsPlaceholder(chatId),
    "💰 финансы": () =>
      sendFinanceMenu(chatId, String(from.id), {
        actorKey: menuActor?.actorKey,
      }),
    "🧠 память": () =>
      sendMemoryMenu(chatId, {
        userId: from?.id,
        actorKey: menuActor?.actorKey,
      }),
    "🌐 открыть almas": () => sendOpenAlmas(chatId),
    "❓ как пользоваться": () => sendHelp(chatId),
    "❓ помощь": () => sendHelp(chatId),
  }[normalizedText];

  if (menuHandler) {
    await menuHandler();
    return;
  }

  // Bare numbers / single punctuation / empty noise — never call AI,
  // never auto-save Memory. Exception: bare numbers with an active
  // navigation context are follow-ups (e.g. "4" after Knowledge list).
  {
    const navPeek = defaultNavigationContextStore.peek(
      menuActor?.actorKey,
      chatId
    );
    if (
      isMeaninglessShortInput(text) &&
      !shouldDeferMeaninglessForNav(text, navPeek)
    ) {
      await sendFallback(chatId);
      return;
    }
  }

  const requestKey = buildRequestKey({ chatId, messageId, text });
  const sourceType = mapInputSourceToInboxSourceType(inputSource);
  const actor = buildActorFromTelegram(from, chatId);
  const inboxNormalizedText = normalizeUserText(text);

  // Unified Inbox shadow observation (disabled by default). Starts the
  // per-requestKey received→analysis→execution chain without awaiting —
  // Telegram replies and domain routing must never wait on Inbox I/O.
  // Menu / meaningless-input paths above never reach this hook.
  startInboxReceivedObservation({
    requestKey,
    sourceType,
    actor,
    originalText: text,
    normalizedText: inboxNormalizedText,
    metadata: {
      inputSource,
      messageId: messageId ?? null,
    },
  });

  const routingContext = {
    inputSource,
    chatId,
    from,
    requestKey,
    sourceType,
    actor,
    normalizedText: inboxNormalizedText,
    originalText: text,
  };

  // Conversation Context + Clarification Engine (thin hook, D-017).
  // After menu / meaningless-input; before AI + legacy domain writes.
  // Pending answers + cancel + incomplete task/memory (active only).
  // Finance incomplete starts later (legacy-owned; any AI_ROUTER_MODE).
  const clarificationTurn = await handleClarificationTurn({
    chatId,
    text,
    from,
    actor,
    requestKey,
    inputSource,
  });
  if (clarificationTurn.handled) {
    return;
  }

  // Navigation context follow-ups + exact domain open commands
  // (before Finance / Tasks / Ideas / Knowledge / Memory).
  const navTurn = await maybeHandleNavigation(
    { chatId, text, from, actor },
    {
      store: defaultNavigationContextStore,
      sendMainMenuFn: (c) =>
        sendMainMenu(c, { actorKey: actor?.actorKey }),
    }
  );
  if (navTurn.handled) {
    return;
  }

  // Pending Capture Session: confirm / edit / cancel (before new writes).
  {
    const captureTurn = await maybeHandleCaptureSessionTurn(
      { chatId, text, from, actor },
      {}
    );
    if (captureTurn.handled) {
      return;
    }
  }

  // Start Capture Session for mixed / long / voice multi-entity messages.
  // Confirm-first — no domain writes until the user taps Сохранить всё.
  {
    const captureStart = await maybeHandleCaptureSessionCreate(
      {
        chatId,
        text,
        from,
        actor,
        requestKey,
        inputSource,
      },
      {
        // Enrich with Universal Extraction when OpenAI is available;
        // deterministic draft remains the offline/safe baseline.
        useUniversalExtraction: true,
        allowDefaultProvider: true,
      }
    );
    if (captureStart.handled) {
      return;
    }
  }

  // AI Intent Analyzer / Action Planner — execution-ownership boundary.
  // Runs only after the menu fast path above, so navigation labels never
  // pay for (or wait on) an AI call.
  //
  // Shadow/off (the default; AI_ROUTER_MODE stays "shadow" in .env for
  // this milestone): fire-and-forget, exactly as before — deliberately
  // NOT awaited, so it can never delay or affect any reply below, and
  // never executes anything (see actionExecutor.js). .catch() stays as a
  // second, defensive guarantee even though observeMessage() itself
  // never throws. Exact deterministic commands are still caught at Tier 0
  // inside decideRouting() (no Tier 1/2 call).
  //
  // Active mode (not enabled live): the validated decision is AWAITED
  // here, before ANY legacy side effect (Finance write, Memory write,
  // destructive delete) can run. `aiOwnership.executedActions` is the
  // single source of truth for which task_create/memory_save actions
  // were ACTUALLY executed (never merely planned) — used below to (a)
  // send a user-visible confirmation and (b) suppress the legacy
  // generic Memory-save fallback for this message only. Finance stays
  // fully legacy-owned and unaffected either way: a mixed message still
  // gets both its AI confirmation and its own Finance confirmation. A
  // decideRouting() failure here is caught and leaves aiOwnership empty,
  // so every legacy branch below runs exactly as if the AI router didn't
  // exist. See services/inbox/routingDecisionService.js.
  let aiOwnership = { executedActions: [] };
  let aiDecision = null;

  if (isAiRouterExecutionActive()) {
    try {
      aiDecision = await decideRouting(text, routingContext);
      aiOwnership = getExecutedOwnedActions(aiDecision);

      if (
        aiDecision?.needsClarification &&
        aiOwnership.executedActions.length === 0
      ) {
        const started = await maybeStartClarificationFromAiDecision({
          chatId,
          text,
          actor,
          decision: aiDecision,
          requestKey,
        });
        if (started.handled) {
          return;
        }
      }
    } catch (error) {
      console.error(
        "[ai-router] active-mode decision failed, falling back to legacy routing:",
        error?.message || error
      );
    }
  } else {
    observeMessage(text, routingContext).catch(() => {});
  }

  const financeQuery = parseFinanceQuery(text);

  console.log("QUERY:", financeQuery);

  // AI-owned execution confirmations (active mode only — always empty in
  // the default shadow mode, so this never sends anything today). Sent
  // as soon as ownership is known so a mixed message ("Потратил 40000 на
  // кофе и завтра купить батарейки") gets BOTH this confirmation AND its
  // own Finance confirmation further below. Only returns early when
  // there is clearly no remaining Finance work for this message —
  // otherwise falls through so deterministic Finance parsing/execution
  // (unaffected by any of this) can still run and send its own reply.
  if (aiOwnership.executedActions.length > 0) {
    await sendAiExecutionConfirmations(chatId, aiOwnership.executedActions);

    const mayStillHaveFinanceWork =
      Boolean(financeQuery?.intent) || looksLikeFinanceAttempt(text);

    if (!mayStillHaveFinanceWork) {
      return;
    }
  }

  // Voice safety: block destructive commands for now. Typed text is
  // unaffected since inputSource defaults to "text" below.
  if (inputSource === "voice") {

    const isDestructiveTextCommand = VOICE_BLOCKED_TEXT_COMMANDS.includes(
      normalizedText
    );

    const isDestructiveFinanceIntent = VOICE_BLOCKED_FINANCE_INTENTS.includes(
      financeQuery?.intent
    );

    if (isDestructiveTextCommand || isDestructiveFinanceIntent) {
      await bot.sendMessage(chatId, VOICE_DESTRUCTIVE_BLOCKED_MESSAGE);
      return;
    }

  }

  if (financeQuery?.intent) {
    const handled = await handleFinanceQuery(
      chatId,
      String(from.id),
      financeQuery
    );

    if (handled) return;
  }

  const finance = parseFinanceMessage(text);
  const finances = parseFinanceMessages(text);
  const batchId = crypto.randomUUID();
  console.log("FINANCES:", finances);
  console.log("COUNT:", finances.length);
  console.log("TEXT:", text);
  console.log("FINANCE:", finance);

  // Incomplete single finance (amount ok, currency/description missing):
  // clarify before any legacy write. Works in any AI_ROUTER_MODE.
  // Multi-item batches keep the existing write path unchanged.
  if (finance && finances.length <= 1) {
    const financeClarify = await maybeStartClarificationFromFinanceAttempt({
      chatId,
      text,
      actor,
      requestKey,
      parsed: finance,
    });
    if (financeClarify.handled) {
      return;
    }
  }

  if (finances.length > 1) {

    console.log(">>> MULTI MODE");
    for (const finance of finances) {

      console.log("Saving:", finance);

      if (finance.type === "expense") {

        const category = detectCategory(finance.description);

        await addExpense({
          amount: finance.amount,
          currency: finance.currency,
          category,
          description: finance.description,
          user_id: String(from.id),
          batch_id: batchId,
        });

      } else if (finance.type === "income") {

        await addIncome({
          amount: finance.amount,
          currency: finance.currency,
          category: "Доход",
          description: finance.description,
          user_id: String(from.id),
          batch_id: batchId,
        });

      }
    }

    console.log(">>> FINISHED");

    await bot.sendMessage(
      chatId,
      `${THIN_CONFIRM.finance}\n\n${THIN_CONFIRM.openFinance}`,
      withMiniAppOpenButton({}, MINI_APP_PATHS.finance, THIN_CONFIRM.openFinance)
    );

    return;
  }
  if (finance) {
    if (finance.type === "expense") {
      const category = detectCategory(finance.description);

      await addExpense({
        amount: finance.amount,
        currency: finance.currency,
        category,
        description: finance.description,
        user_id: String(from.id),
      });

      await bot.sendMessage(
        chatId,
        `${THIN_CONFIRM.finance}\n\n${THIN_CONFIRM.openFinance}`,
        withMiniAppOpenButton({}, MINI_APP_PATHS.finance, THIN_CONFIRM.openFinance)
      );

      return;
    }

    if (finance.type === "income") {
      await addIncome({
        amount: finance.amount,
        currency: finance.currency,
        category: "Доход",
        description: finance.description,
        user_id: String(from.id),
      });

      await bot.sendMessage(
        chatId,
        `${THIN_CONFIRM.finance}\n\n${THIN_CONFIRM.openFinance}`,
        withMiniAppOpenButton({}, MINI_APP_PATHS.finance, THIN_CONFIRM.openFinance)
      );

      return;
    }
  }

  // Finance-like input (starts with a known expense/income word, e.g.
  // "расход"/"доход"/"купил") that failed to parse — most commonly a
  // spelled-out amount like "расход сорок тысяч кофе" — must not be
  // silently saved as a Memory note. Word-to-number parsing is out of
  // scope for now: finance input must use digits, e.g. "расход 40000
  // кофе". This falls through to the "not recognized" fallback below
  // instead of being saved.
  // Finance-like text that failed to parse entirely — still must not
  // become Memory (unchanged). Clarification requires a parsed amount.
  const isUnparsedFinanceAttempt =
    !finance && finances.length === 0 && looksLikeFinanceAttempt(text);

  // Приветствие
  if (text === "Привет") {
    await bot.sendMessage(chatId, "Привет, Алмас! 👋");
    return;
  }

  // Удалить все знания
  if (VOICE_BLOCKED_TEXT_COMMANDS.includes(normalizedText)) {
    const deleted = await deleteAllKnowledge();

    await bot.sendMessage(
      chatId,
      `🗑 Удалено: ${deleted} знаний.`
    );

    return;
  }
  // Read-only Answer Engine — "спроси …" (replaces legacy RAG chat path).
  if (text.toLowerCase().startsWith("спроси ")) {
    const answered = await maybeHandleAnswerQuestion(
      { chatId, text, from, actor },
      {}
    );
    if (answered.handled) return;
  }

// Мои знания / Покажи мои знания
if (isKnowledgeListCommand(text)) {
  const reply = thinOpenReply(
    `📚 Knowledge\n\n${THIN_CONFIRM.openKnowledge}`,
    MINI_APP_PATHS.knowledge,
    THIN_CONFIRM.openKnowledge
  );
  await bot.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  return;
}

// Открыть знание N — thin deep link (detail in Mini App)
if (isKnowledgeOpenCommand(text)) {
  const index = extractKnowledgeIndex(text);
  if (index == null || Number.isNaN(index)) {
    await bot.sendMessage(chatId, "❌ Укажи номер знания.");
    return;
  }
  const knowledge = await getKnowledgeByIndex(index);
  if (!knowledge) {
    await bot.sendMessage(chatId, "❌ Знание не найдено.");
    return;
  }
  const reply = thinOpenReply(
    `📚 Knowledge ready.\n\n${THIN_CONFIRM.openKnowledge}`,
    MINI_APP_PATHS.knowledge,
    THIN_CONFIRM.openKnowledge
  );
  await bot.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  keepNavigationContextAfterOpen(
    defaultNavigationContextStore,
    actor?.actorKey,
    chatId,
    { section: "knowledge", cursor: index }
  );
  return;
}

// Read-only Answer Engine — "найди"/"найти"/"вспомни" (search / recall).
if (
  text.toLowerCase().startsWith("найди ") ||
  text.toLowerCase().startsWith("найти ") ||
  text.toLowerCase().startsWith("вспомни ")
) {
  const answered = await maybeHandleAnswerQuestion(
    { chatId, text, from, actor },
    {}
  );
  if (answered.handled) return;
}

// Мои задачи
if (text.toLowerCase() === "мои задачи") {
  const reply = thinOpenReply(
    `📋 Tasks\n\n${THIN_CONFIRM.openTasks}`,
    MINI_APP_PATHS.tasks,
    THIN_CONFIRM.openTasks
  );
  await bot.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  return;
}

// Выполнить задачу
if (text.toLowerCase().startsWith("выполнено ")) {
  const index = Number(text.split(" ")[1]);
  if (Number.isNaN(index)) {
    await bot.sendMessage(chatId, "❌ Укажи номер задачи.");
    return;
  }
  const task = await completeTask(index);
  if (!task) {
    await bot.sendMessage(chatId, "❌ Задача не найдена.");
    return;
  }
  const reply = thinOpenReply(
    `✅ Done.\n\n${THIN_CONFIRM.openTasks}`,
    MINI_APP_PATHS.tasks,
    THIN_CONFIRM.openTasks
  );
  await bot.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  return;
}

// Выполненные задачи
if (text.toLowerCase() === "выполненные задачи") {
  const reply = thinOpenReply(
    `📋 Tasks\n\n${THIN_CONFIRM.openTasks}`,
    MINI_APP_PATHS.tasks,
    THIN_CONFIRM.openTasks
  );
  await bot.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  return;
}

// Finance reads → Mini App
if (
  text.toLowerCase() === "баланс" ||
  text.toLowerCase() === "история" ||
  text.toLowerCase() === "статистика" ||
  text.toLowerCase().startsWith("сколько потратил на ") ||
  text.toLowerCase() === "расходы за сегодня" ||
  text.toLowerCase() === "расходы за неделю" ||
  text.toLowerCase() === "расходы за месяц"
) {
  const reply = thinOpenReply(
    `💰 Finance\n\n${THIN_CONFIRM.openFinance}`,
    MINI_APP_PATHS.finance,
    THIN_CONFIRM.openFinance
  );
  await bot.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  return;
}

    // YouTube
if (isYouTubeLink(text)) {
  await handleYouTube(chatId, text);
  return;
}

// Ideas domain experience (list / open / search) — before Answer Engine
// so Ideas are not collapsed into a generic prose summary.
{
  const ideasRead = await maybeHandleIdeasExperience(
    { chatId, text, from, actor },
    {}
  );
  if (ideasRead.handled) return;
}

// Read-only Answer Engine — open information questions that fell through
// exact commands / execution. Must run before memory-save fallthrough.
{
  const answered = await maybeHandleAnswerQuestion(
    { chatId, text, from, actor },
    {}
  );
  if (answered.handled) return;
}

// Ideas Capture — save immediately without forcing a category.
// Skipped when AI router already executed idea_create for this message.
if (
  !aiOwnership.executedActions.some((r) => r?.action?.type === "idea_create") &&
  !isUnparsedFinanceAttempt
) {
  const ideaCaptured = await maybeCaptureIdea(
    {
      chatId,
      text,
      from,
      actor,
      inputSource,
    },
    {}
  );
  if (ideaCaptured.handled) return;
}

// Память — сохраняется только если ничего выше не сработало, то есть
// текст не является ни одной из распознанных команд (деструктивной,
// финансовой, задачной и т.д.), не похож на неудавшуюся попытку
// финансовой команды, и AI-роутер уже не сохранил это же сообщение сам
// (task_create/memory_save в активном режиме) — иначе получилось бы
// дублирование или неверная классификация по ключевым словам.
if (!aiOwnership.executedActions.length && !isUnparsedFinanceAttempt && shouldSaveMemory(text)) {
  const memory = classifyMemory(text);
  const extracted = extractLegacyMemorySaveContent(text);
  const contentToStore =
    extracted.kind === "save" && extracted.content
      ? extracted.content
      : text;

  const saved = await saveMemory({
    source: "telegram",
    type: "message",
    content: contentToStore,
    metadata: {
      memoryType: memory.memoryType,
      importance: memory.importance,
      status: memory.status,
      tags: memory.tags,
      chatId,
      userId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
  });

  if (saved) {
    await bot.sendMessage(
      chatId,
      `${THIN_CONFIRM.memory}\n\n${THIN_CONFIRM.openMemory}`,
      withMiniAppOpenButton({}, MINI_APP_PATHS.memory, THIN_CONFIRM.openMemory)
    );
    return;
  }
}

// AI уже обработал это сообщение (подтверждение(я) уже отправлены выше),
// и ничего другое ниже его не распознало — нельзя показывать стандартный
// fallback "не понял запрос" после успешного AI-действия.
if (aiOwnership.executedActions.length > 0) {
  return;
}

// Если команда не распознана — показываем короткое меню вместо старого
// длинного списка команд (онбординг доступен по кнопке "❓ Как пользоваться",
// см. handlers/routes/menuRoute.js#sendHelp).
await sendFallback(chatId);

}

export function registerMessageHandler() {
  bot.on("message", async (msg) => {

    const chatId = msg.chat.id;

    // Голосовые сообщения: распознаём и показываем текст пользователю,
    // затем маршрутизируем распознанный текст через тот же routeText(),
    // что и обычные текстовые сообщения (Finance/Memory/Tasks/Knowledge/
    // Chat/Commands). Опасные команды блокируются внутри routeText() для
    // inputSource: "voice".
    if (msg.voice) {
      const recognizedText = await handleVoiceMessage(chatId, msg.voice);

      if (!recognizedText) return;

      return routeText(chatId, recognizedText, msg.from, {
        inputSource: "voice",
        messageId: msg.message_id,
      });
    }

    const text = msg.text?.trim();

    if (!text) return;

    return routeText(chatId, text, msg.from, { messageId: msg.message_id });

  });
}
