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

/**
 * Production wiring for the read-only Mini App API.
 * Does not start Telegram bot polling — run separately via `npm start`.
 *
 * Only read helpers are invoked (getBalance/getHistory/listInboxItems).
 * Application-level actor filters do not replace database RLS.
 */
export function buildDefaultApp(env = process.env) {
  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("BOT_TOKEN is required to start the ALMAS API");
  }

  const financeReader = createFinanceReader({
    getBalanceFn: getBalance,
    getHistoryFn: getHistory,
    getExpensesByPeriodFn: getExpensesByPeriod,
    getStatisticsFn: getStatistics,
  });

  // Reader ignores INBOX_ENABLED — reads scoped rows when the table is available.
  const inboxReader = createInboxReader({
    listInboxItemsFn: listInboxItems,
  });

  // Fail closed: no ownership-scoped query available for tasks/knowledge yet.
  const tasksReader = createTasksReader({});
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
  const host = env.ALMAS_API_HOST || "127.0.0.1";
  const port = Number(env.ALMAS_API_PORT) || 8787;
  const app = buildDefaultApp(env);

  const server = app.listen(port, host, () => {
    console.log(`ALMAS read-only API listening on http://${host}:${port}`);
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
