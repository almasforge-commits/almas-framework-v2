/**
 * Narrow composition root for Telegram World Knowledge wiring (D-028/D-029).
 * No globals. No secrets. Mock providers only when explicitly allowed.
 * Official RSS/Atom provider registered only when feeds are enabled.
 */

import {
  getWorldKnowledgeConfig,
  WORLD_KNOWLEDGE_MODES,
} from "../../config/worldKnowledge.js";
import {
  getWorldKnowledgeFeeds,
  listEnabledFeeds,
} from "../../config/worldKnowledgeFeeds.js";
import { createProviderManager } from "./providerManager.js";
import { createInMemoryWorldCache } from "./providerCache.js";
import { createWorldKnowledgeGateway } from "./worldKnowledgeGateway.js";
import { registerDefaultMockProviders } from "./mockProviders.js";
import { createOfficialFeedProvider } from "./providers/officialFeedProvider.js";

/**
 * Build a World Knowledge Gateway for Telegram Answer DI, or null when off.
 *
 * @param {object} [deps]
 * @returns {Promise<{
 *   gateway: object|null,
 *   mode: string,
 *   config: object,
 *   rawGateway: object|null,
 *   audits: object[],
 * }>}
 */
export async function createWorldKnowledgeForTelegram(deps = {}) {
  const env = deps.env ?? process.env;
  const config = deps.config ?? getWorldKnowledgeConfig(env);
  const mode = config.effectiveMode || WORLD_KNOWLEDGE_MODES.OFF;
  const audits = [];
  const onAudit =
    typeof deps.onAudit === "function"
      ? deps.onAudit
      : (entry) => {
          audits.push(entry);
          logSanitizedShadowAudit(entry, deps.logger);
        };

  if (mode === WORLD_KNOWLEDGE_MODES.OFF) {
    return {
      gateway: null,
      mode: WORLD_KNOWLEDGE_MODES.OFF,
      config,
      rawGateway: null,
      audits,
    };
  }

  const logger = deps.logger || {
    log() {},
    error() {},
  };

  const manager = deps.providerManager ?? createProviderManager({ logger });
  const cache =
    deps.cache === null
      ? null
      : deps.cache ??
        createInMemoryWorldCache({
          defaultTtlMs: config.cacheTtlMs,
          nowFn: deps.nowFn,
        });

  const rawGateway = createWorldKnowledgeGateway({
    config: {
      ...config,
      // Factory already gated by effectiveMode; gateway search must run.
      enabled: true,
    },
    env,
    logger,
    providerManager: manager,
    cache,
    nowFn: deps.nowFn,
  });

  if (Array.isArray(deps.providers) && deps.providers.length > 0) {
    await rawGateway.initializeProviders(deps.providers);
  } else if (deps.allowMockProviders === true) {
    // Explicit test/dev only — never default for production Telegram.
    await registerDefaultMockProviders(rawGateway.manager);
  } else {
    const registry = deps.feedRegistry ?? deps.feeds ?? getWorldKnowledgeFeeds();
    const enabledFeeds = listEnabledFeeds(registry);
    if (enabledFeeds.length > 0) {
      const feedProvider = createOfficialFeedProvider({
        feeds: enabledFeeds,
        env,
        config,
        fetchFn: deps.fetchFn,
        nowFn: deps.nowFn,
        logger,
        allowIpHosts: deps.allowIpHosts === true,
        feedCache: deps.feedCache,
      });
      await rawGateway.initializeProviders([feedProvider]);
    }
  }

  const timeoutMs = config.timeoutMs ?? config.providerTimeoutMs ?? 3_000;
  const timed = wrapGatewayTimeout(rawGateway, timeoutMs, deps.nowFn);

  if (mode === WORLD_KNOWLEDGE_MODES.SHADOW) {
    return {
      gateway: wrapShadowGateway(timed, onAudit, deps.nowFn),
      mode: WORLD_KNOWLEDGE_MODES.SHADOW,
      config,
      rawGateway,
      audits,
    };
  }

  // active
  return {
    gateway: timed,
    mode: WORLD_KNOWLEDGE_MODES.ACTIVE,
    config,
    rawGateway,
    audits,
  };
}

/**
 * Sync helper: whether Telegram wiring would construct a gateway.
 * @param {object} [env]
 */
export function isWorldKnowledgeWiringEnabled(env = process.env) {
  const config = getWorldKnowledgeConfig(env);
  return config.effectiveMode !== WORLD_KNOWLEDGE_MODES.OFF;
}

/**
 * Shadow wrapper: runs real search for audit, returns empty results to Answer Engine
 * so Telegram replies stay identical to no-world behavior.
 */
export function wrapShadowGateway(gateway, onAudit, nowFn = () => Date.now()) {
  return {
    search: async (query, options = {}) => {
      const started = nowFn();
      let providersCalled = 0;
      let resultsReceived = 0;
      let reason = "ok";
      try {
        const response = await gateway.search(query, options);
        providersCalled = Array.isArray(response?.providers)
          ? response.providers.length
          : 0;
        resultsReceived = Number(response?.count) || 0;
        reason = sanitizeReasonCode(response?.reason || "ok");
        emitAudit(onAudit, {
          attempted: true,
          providersCalled,
          resultsReceived,
          latencyMs: Math.max(0, nowFn() - started),
          reason,
        });
        return {
          ok: true,
          query: "",
          results: [],
          count: 0,
          providers: Array.isArray(response?.providers) ? response.providers : [],
          errors: [],
          cacheHit: Boolean(response?.cacheHit),
          retrievedAt: response?.retrievedAt ?? nowFn(),
          shadow: true,
          reason: "shadow_suppressed",
        };
      } catch {
        emitAudit(onAudit, {
          attempted: true,
          providersCalled: 0,
          resultsReceived: 0,
          latencyMs: Math.max(0, nowFn() - started),
          reason: "error",
        });
        return {
          ok: true,
          query: "",
          results: [],
          count: 0,
          providers: [],
          errors: [],
          cacheHit: false,
          retrievedAt: nowFn(),
          shadow: true,
          reason: "shadow_error",
        };
      }
    },
    listProviders: () => gateway.listProviders?.() ?? [],
    initializeProviders: (p) => gateway.initializeProviders?.(p),
    registerProvider: (p) => gateway.registerProvider?.(p),
    unregisterProvider: (id) => gateway.unregisterProvider?.(id),
    clearCache: () => gateway.clearCache?.(),
    config: gateway.config,
    manager: gateway.manager,
    cache: gateway.cache,
  };
}

/**
 * Bound the whole gateway.search call; never throw to Answer Engine.
 */
export function wrapGatewayTimeout(gateway, timeoutMs, nowFn = () => Date.now()) {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3_000;
  return {
    search: async (query, options = {}) => {
      try {
        return await promiseWithTimeout(
          Promise.resolve(
            gateway.search(query, {
              ...options,
              timeoutMs: options.timeoutMs ?? ms,
            })
          ),
          ms
        );
      } catch {
        return {
          ok: true,
          query: String(query ?? "").trim(),
          results: [],
          count: 0,
          providers: gateway.listProviders?.() ?? [],
          errors: [{ code: "gateway_timeout", message: "timeout" }],
          cacheHit: false,
          retrievedAt: nowFn(),
          reason: "timeout",
        };
      }
    },
    listProviders: () => gateway.listProviders?.() ?? [],
    initializeProviders: (p) => gateway.initializeProviders?.(p),
    registerProvider: (p) => gateway.registerProvider?.(p),
    unregisterProvider: (id) => gateway.unregisterProvider?.(id),
    clearCache: () => gateway.clearCache?.(),
    config: gateway.config,
    manager: gateway.manager,
    cache: gateway.cache,
  };
}

function promiseWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error("gateway_timeout");
      err.code = "gateway_timeout";
      reject(err);
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function emitAudit(onAudit, entry) {
  try {
    onAudit?.(sanitizeAuditEntry(entry));
  } catch {
    // never break Answer path
  }
}

function sanitizeAuditEntry(entry = {}) {
  return {
    attempted: entry.attempted === true,
    providersCalled: Math.max(0, Number(entry.providersCalled) || 0),
    resultsReceived: Math.max(0, Number(entry.resultsReceived) || 0),
    latencyMs: Math.max(0, Number(entry.latencyMs) || 0),
    reason: sanitizeReasonCode(entry.reason),
  };
}

function sanitizeReasonCode(reason) {
  const r = String(reason ?? "ok")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "")
    .slice(0, 48);
  return r || "ok";
}

function logSanitizedShadowAudit(entry, logger) {
  const line = `[world-knowledge:shadow] attempted=${entry.attempted} providersCalled=${entry.providersCalled} resultsReceived=${entry.resultsReceived} latencyMs=${entry.latencyMs} reason=${entry.reason}`;
  if (logger?.log) logger.log(line);
  else console.log(line);
}
