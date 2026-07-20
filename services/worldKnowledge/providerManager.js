/**
 * Provider manager — dynamic register / unregister / list.
 */

import { validateProvider } from "./providerValidator.js";
import { isWorldProvider } from "./providerContracts.js";

/**
 * @param {object} [deps]
 */
export function createProviderManager(deps = {}) {
  /** @type {Map<string, object>} */
  const providers = new Map();
  const logger = deps.logger || { log() {}, error() {} };

  return {
    /**
     * @param {object} provider
     */
    async registerProvider(provider) {
      validateProvider(provider);
      const id = String(provider.id).trim();
      if (providers.has(id)) {
        await this.unregisterProvider(id);
      }
      await Promise.resolve(provider.initialize());
      providers.set(id, provider);
      logger.log?.(`[world-knowledge] registered provider=${id}`);
      return id;
    },

    /**
     * @param {string} id
     */
    async unregisterProvider(id) {
      const key = String(id ?? "").trim();
      const existing = providers.get(key);
      if (!existing) return false;
      providers.delete(key);
      try {
        await Promise.resolve(existing.shutdown());
      } catch {
        // ignore shutdown failures
      }
      logger.log?.(`[world-knowledge] unregistered provider=${key}`);
      return true;
    },

    listProviders() {
      return [...providers.keys()].sort();
    },

    getProvider(id) {
      return providers.get(String(id ?? "").trim()) || null;
    },

    getProviders() {
      return [...providers.values()];
    },

    size() {
      return providers.size;
    },

    isWorldProvider,
  };
}
