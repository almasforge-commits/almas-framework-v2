/**
 * World Knowledge Gateway — single entry for external knowledge providers.
 * Never stores personal knowledge. Never calls Telegram / Answer Engine.
 */

import { getWorldKnowledgeConfig } from "../../config/worldKnowledge.js";
import { createProviderManager } from "./providerManager.js";
import { createInMemoryWorldCache } from "./providerCache.js";
import { normalizeProviderResults } from "./providerNormalizer.js";
import { rankWorldResults } from "./providerRanker.js";
import {
  WORLD_KNOWLEDGE_ERROR,
  sanitizeWorldError,
  createWorldKnowledgeError,
} from "./providerErrors.js";

/**
 * @param {object} [deps]
 */
export function createWorldKnowledgeGateway(deps = {}) {
  const config =
    deps.config ?? getWorldKnowledgeConfig(deps.env ?? process.env);
  const nowFn = deps.nowFn ?? (() => Date.now());
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
          nowFn,
        });

  if (Array.isArray(deps.providers)) {
    // Sync registration deferred — callers should await initializeProviders.
  }

  async function initializeProviders(providers = deps.providers || []) {
    for (const p of providers) {
      await manager.registerProvider(p);
    }
  }

  /**
   * Search all registered providers; merge, dedupe, rank.
   * @param {string} query
   * @param {object} [options]
   */
  async function search(query, options = {}) {
    const q = String(query ?? "").trim();
    const forceEnabled = options.forceEnabled === true;
    const ignoreEnabled = options.ignoreEnabled === true;
    if (!forceEnabled && !ignoreEnabled && config.enabled !== true) {
      return emptyResponse(q, {
        reason: "disabled",
        providers: manager.listProviders(),
      });
    }

    if (!q) {
      return emptyResponse("", {
        reason: "empty_query",
        providers: manager.listProviders(),
      });
    }

    const maxResults = options.maxResults ?? config.maxResults;
    const maxPerProvider = options.maxPerProvider ?? config.maxPerProvider;
    const timeoutMs = options.timeoutMs ?? config.providerTimeoutMs;
    const cacheKey = `wk:${q}:${maxResults}:${manager.listProviders().join(",")}`;

    if (cache && options.skipCache !== true) {
      const hit = cache.get(cacheKey);
      if (hit) {
        return {
          ...hit,
          cacheHit: true,
        };
      }
    }

    const providers = manager.getProviders();
    if (providers.length === 0) {
      return emptyResponse(q, {
        reason: "no_providers",
        providers: [],
      });
    }

    const retrievedAt = nowFn();
    const errors = [];
    const merged = [];

    await Promise.all(
      providers.map(async (provider) => {
        try {
          const rows = await withTimeout(
            Promise.resolve(
              provider.search(q, {
                limit: maxPerProvider,
                language: options.language,
                ...(options.providerOptions || {}),
              })
            ),
            timeoutMs,
            provider.id
          );
          const normalized = normalizeProviderResults(rows, provider.id);
          merged.push(...normalized);
        } catch (error) {
          errors.push(
            sanitizeWorldError(
              error?.code
                ? error
                : createWorldKnowledgeError(
                    WORLD_KNOWLEDGE_ERROR.PROVIDER_ERROR,
                    error?.message || "provider_error",
                    { provider: provider.id }
                  )
            )
          );
          logger.log?.(
            `[world-knowledge] provider failed id=${provider.id} code=${errors[errors.length - 1].code}`
          );
        }
      })
    );

    const results = rankWorldResults(merged, {
      nowMs: retrievedAt,
      maxResults,
      query: q,
      retrievedAt,
    });

    const response = {
      ok: true,
      query: q,
      results,
      count: results.length,
      providers: manager.listProviders(),
      errors,
      cacheHit: false,
      retrievedAt,
    };

    if (cache && options.skipCache !== true) {
      cache.set(cacheKey, { ...response, cacheHit: false }, options.ttlMs);
    }

    return response;
  }

  return {
    search,
    initializeProviders,
    registerProvider: (p) => manager.registerProvider(p),
    unregisterProvider: (id) => manager.unregisterProvider(id),
    listProviders: () => manager.listProviders(),
    clearCache: () => cache?.clear?.(),
    config,
    manager,
    cache,
  };
}

function emptyResponse(query, extra = {}) {
  return {
    ok: true,
    query,
    results: [],
    count: 0,
    providers: [],
    errors: [],
    cacheHit: false,
    retrievedAt: Date.now(),
    ...extra,
  };
}

function withTimeout(promise, ms, providerId) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        createWorldKnowledgeError(
          WORLD_KNOWLEDGE_ERROR.PROVIDER_TIMEOUT,
          "provider_timeout",
          { provider: providerId }
        )
      );
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

/**
 * Isolated gateway for tests (enabled search without env).
 */
export function createIsolatedWorldKnowledgeGateway(deps = {}) {
  return createWorldKnowledgeGateway({
    ...deps,
    env: deps.env ?? {},
    config: deps.config ?? {
      enabled: true,
      cacheTtlMs: 60_000,
      providerTimeoutMs: 3_000,
      maxResults: 20,
      maxPerProvider: 8,
    },
  });
}
