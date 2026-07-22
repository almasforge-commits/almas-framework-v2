import "dotenv/config";
import {
  getBalance,
  getHistory,
  getExpensesByPeriod,
  getStatistics,
} from "../services/finance/financeService.js";
import { listInboxItems } from "../providers/storage/supabaseInboxDriver.js";
import { createApp } from "./createApp.js";
import { createFinanceReader } from "./readers/financeReader.js";
import { createInboxReader } from "./readers/inboxReader.js";
import { createTasksReader } from "./readers/tasksReader.js";
import { createKnowledgeReader } from "./readers/knowledgeReader.js";
import { createIdeasReader } from "./readers/ideasReader.js";
import { createDashboardReader } from "./readers/dashboardReader.js";
import { createCaptureReader } from "./readers/captureReader.js";
import { createMemoryReader } from "./readers/memoryReader.js";
import { parseCorsAllowlist } from "./cors.js";
import { listIdeasForActor, searchIdeas, getIdeaById } from "../services/ideas/ideaService.js";
import { defaultCaptureSessionStore } from "../services/capture/captureSessionStore.js";
import { listMemoriesForActor } from "../services/storage/listMemoriesForActor.js";
import { listTasksForActor } from "../services/storage/listTasksForActor.js";
import {
  botTokenFingerprint,
  normalizeBotToken,
} from "./auth/validateInitData.js";

/**
 * Resolve listen host/port for local vs hosted runtimes.
 * Hosted (Railway/Render/etc.): PORT is set → bind 0.0.0.0.
 * Local: keep 127.0.0.1 unless ALMAS_API_HOST overrides.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveListenConfig(env = process.env) {
  const hosted = Boolean(
    env.PORT ||
      env.RAILWAY_ENVIRONMENT ||
      env.RENDER ||
      env.FLY_APP_NAME
  );
  const port = Number(env.PORT || env.ALMAS_API_PORT) || 8787;
  const host =
    env.ALMAS_API_HOST || (hosted ? "0.0.0.0" : "127.0.0.1");
  return { host, port, hosted };
}

/**
 * Production wiring for the Mini App API.
 * Does not start Telegram bot polling — run separately via `npm start`.
 *
 * Application-level actor filters do not replace database RLS.
 */
export function buildDefaultApp(env = process.env) {
  const botToken = normalizeBotToken(env.BOT_TOKEN);
  if (!botToken) {
    throw new Error("BOT_TOKEN is required to start the ALMAS API");
  }

  const financeReader = createFinanceReader({
    getBalanceFn: getBalance,
    getHistoryFn: getHistory,
    getExpensesByPeriodFn: getExpensesByPeriod,
    getStatisticsFn: getStatistics,
  });

  const inboxReader = createInboxReader({
    listInboxItemsFn: listInboxItems,
  });

  const tasksReader = createTasksReader({
    listTasksForUserFn: async (actor, opts = {}) => {
      const userId =
        actor?.userId ||
        (actor?.telegramUserId != null
          ? String(actor.telegramUserId)
          : null);
      if (!userId) return [];
      return listTasksForActor(userId, {
        limit: opts.limit || 40,
        status: "active",
      });
    },
  });

  // Knowledge table has no owner column — fail closed (do not leak global rows).
  const knowledgeReader = createKnowledgeReader({});

  const ideasReader = createIdeasReader({
    listIdeasForUserFn: async (actor, opts = {}) => {
      const actorKey = actor?.actorKey;
      if (!actorKey) return [];
      return listIdeasForActor(actorKey, opts);
    },
    searchIdeasForUserFn: async (actor, opts = {}) => {
      const actorKey = actor?.actorKey;
      if (!actorKey) return [];
      return searchIdeas(opts.q || "", {
        actorKey,
        category: opts.category,
        limit: opts.limit || 20,
      });
    },
    getIdeaForUserFn: async (actor, ideaId) => {
      const actorKey = actor?.actorKey;
      if (!actorKey) return null;
      return getIdeaById(ideaId, actorKey);
    },
  });

  const dashboardReader = createDashboardReader({
    financeReader,
    inboxReader,
    tasksReader,
    knowledgeReader,
  });

  const captureReader = createCaptureReader({
    store: defaultCaptureSessionStore,
  });

  const memoryReader = createMemoryReader({
    listMemoriesForUserFn: listMemoriesForActor,
  });

  return createApp({
    botToken,
    financeReader,
    inboxReader,
    tasksReader,
    knowledgeReader,
    ideasReader,
    dashboardReader,
    captureReader,
    memoryReader,
    captureStore: defaultCaptureSessionStore,
    corsAllowlist: parseCorsAllowlist(env.ALMAS_API_CORS_ORIGIN),
  });
}

export function startServer(env = process.env) {
  const { host, port } = resolveListenConfig(env);
  const app = buildDefaultApp(env);
  const fingerprint = botTokenFingerprint(env.BOT_TOKEN);

  const server = app.listen(port, host, () => {
    console.log(`ALMAS API listening on http://${host}:${port}`);
    // Non-reversible ops check only — never log BOT_TOKEN itself.
    console.log(`[auth] botTokenFingerprint=${fingerprint}`);
  });

  const shutdown = (signal) => {
    console.log(`[almas-api] ${signal} received, shutting down`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  return server;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/api/server.js") ||
    process.argv[1].endsWith("\\api\\server.js"));

if (isMain) {
  startServer();
}
