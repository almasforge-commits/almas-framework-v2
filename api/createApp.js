import express from "express";
import { createAuthTelegramMiddleware } from "./middleware/authTelegram.js";
import { HttpError, sendError } from "./httpErrors.js";
import { parseCorsAllowlist, resolveCorsOrigin } from "./cors.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createInboxRouter } from "./routes/inbox.js";
import { createFinanceRouter } from "./routes/finance.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createKnowledgeRouter } from "./routes/knowledge.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Build the read-only ALMAS Mini App API (HTTP; TLS terminates at the proxy).
 *
 * Auth header is an ALMAS convention: Authorization: tma <raw initData>
 * — not an official Telegram HTTP requirement.
 */
export function createApp(deps) {
  if (!deps?.botToken) {
    throw new Error("createApp requires deps.botToken");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  const log =
    typeof deps.log === "function"
      ? deps.log
      : (code) => {
          // Concise reason codes only — never initData, hash, token, or user JSON.
          console.error(`[almas-api] ${code}`);
        };

  const allowlist = Array.isArray(deps.corsAllowlist)
    ? deps.corsAllowlist
    : parseCorsAllowlist(deps.corsOrigin);

  app.use((req, res, next) => {
    const allowed = resolveCorsOrigin(allowlist, req.headers.origin);
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", allowed);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type"
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  const timeoutMs = Number.isFinite(deps.requestTimeoutMs)
    ? deps.requestTimeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;

  app.use((req, res, next) => {
    req.setTimeout(timeoutMs);
    res.setTimeout(timeoutMs);
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ data: { ok: true } });
  });

  const auth = createAuthTelegramMiddleware({
    botToken: deps.botToken,
    nowMs: deps.nowMs,
    maxAgeSeconds: deps.maxAgeSeconds,
    clockSkewSeconds: deps.clockSkewSeconds,
    validateInitDataFn: deps.validateInitDataFn,
    log,
  });

  const Router = express.Router;
  const routeDeps = {
    Router,
    dashboardReader: deps.dashboardReader,
    inboxReader: deps.inboxReader,
    financeReader: deps.financeReader,
    tasksReader: deps.tasksReader,
    knowledgeReader: deps.knowledgeReader,
  };

  app.use("/api/dashboard", auth, createDashboardRouter(routeDeps));
  app.use("/api/inbox", auth, createInboxRouter(routeDeps));
  app.use("/api/finance", auth, createFinanceRouter(routeDeps));
  app.use("/api/tasks", auth, createTasksRouter(routeDeps));
  app.use("/api/knowledge", auth, createKnowledgeRouter(routeDeps));

  app.use((req, res) => {
    sendError(
      res,
      new HttpError(404, "not_found", "Not found"),
      log
    );
  });

  app.use((err, _req, res, _next) => {
    sendError(res, err, log);
  });

  return app;
}
