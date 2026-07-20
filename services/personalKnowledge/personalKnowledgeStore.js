/**
 * Bounded in-memory Personal Knowledge store.
 * Injectable. Actor-scoped. Deterministic FIFO eviction when over capacity.
 */

import { buildIdempotencyKey } from "./personalKnowledgeContracts.js";

const DEFAULT_MAX_ENTRIES = 2000;

/**
 * @param {object} [options]
 */
export function createPersonalKnowledgeStore(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries)
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES;

  /** @type {Map<string, object>} id → fact */
  const byId = new Map();
  /** @type {Map<string, string>} idempotencyKey → id */
  const byIdempotency = new Map();
  /** @type {string[]} insertion order for eviction */
  const order = [];

  function requireActorKey(actorKey) {
    const key = String(actorKey ?? "").trim();
    if (!key) {
      throw new Error("personal_knowledge_store_missing_actor_key");
    }
    return key;
  }

  function evictIfNeeded() {
    while (byId.size > maxEntries && order.length > 0) {
      const oldestId = order.shift();
      const fact = byId.get(oldestId);
      if (!fact) continue;
      byId.delete(oldestId);
      if (fact.idempotencyKey) byIdempotency.delete(fact.idempotencyKey);
    }
  }

  function touchOrder(id) {
    const idx = order.indexOf(id);
    if (idx >= 0) order.splice(idx, 1);
    order.push(id);
  }

  return {
    /**
     * Upsert by idempotency key. Actor must match on update.
     * @param {object} fact
     */
    upsert(fact) {
      const actorKey = requireActorKey(fact.actorKey);
      const idempotencyKey =
        fact.idempotencyKey ||
        buildIdempotencyKey(
          actorKey,
          fact.domain,
          fact.normalizedContent,
          fact.requestKey
        );

      const existingId = byIdempotency.get(idempotencyKey);
      if (existingId) {
        const existing = byId.get(existingId);
        if (existing && existing.actorKey !== actorKey) {
          throw new Error("personal_knowledge_store_actor_mismatch");
        }
        const updated = {
          ...existing,
          ...fact,
          id: existing.id,
          actorKey,
          idempotencyKey,
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
          scope: "personal",
        };
        byId.set(existing.id, updated);
        touchOrder(existing.id);
        return { fact: updated, created: false };
      }

      const id = fact.id || `pkf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created = {
        ...fact,
        id,
        actorKey,
        idempotencyKey,
        scope: "personal",
        updatedAt: fact.updatedAt ?? Date.now(),
        createdAt: fact.createdAt ?? Date.now(),
      };
      byId.set(id, created);
      byIdempotency.set(idempotencyKey, id);
      touchOrder(id);
      evictIfNeeded();
      return { fact: created, created: true };
    },

    /**
     * @param {string} actorKey
     * @param {string} id
     */
    getById(actorKey, id) {
      const key = requireActorKey(actorKey);
      const fact = byId.get(id);
      if (!fact || fact.actorKey !== key) return null;
      return fact;
    },

    /**
     * @param {string} actorKey
     * @param {object} [opts]
     */
    listByActor(actorKey, opts = {}) {
      const key = requireActorKey(actorKey);
      const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
      const out = [];
      for (let i = order.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const fact = byId.get(order[i]);
        if (fact && fact.actorKey === key && fact.status === "active") {
          out.push(fact);
        }
      }
      return out;
    },

    /**
     * @param {string} actorKey
     * @param {string} domain
     * @param {object} [opts]
     */
    listByDomain(actorKey, domain, opts = {}) {
      const key = requireActorKey(actorKey);
      if (!domain) throw new Error("personal_knowledge_store_missing_domain");
      const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
      const out = [];
      for (let i = order.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const fact = byId.get(order[i]);
        if (
          fact &&
          fact.actorKey === key &&
          fact.domain === domain &&
          fact.status === "active"
        ) {
          out.push(fact);
        }
      }
      return out;
    },

    /**
     * Simple lexical / normalized match. Actor-scoped.
     * @param {string} actorKey
     * @param {string} query
     * @param {object} [opts]
     */
    search(actorKey, query, opts = {}) {
      const key = requireActorKey(actorKey);
      const q = String(query ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!q) return [];
      const limit = Number.isFinite(opts.limit) ? opts.limit : 20;
      const domains = Array.isArray(opts.domains) ? new Set(opts.domains) : null;
      const out = [];
      for (let i = order.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const fact = byId.get(order[i]);
        if (!fact || fact.actorKey !== key || fact.status !== "active") continue;
        if (domains && !domains.has(fact.domain)) continue;
        if (
          fact.normalizedContent.includes(q) ||
          fact.content.toLowerCase().includes(q)
        ) {
          out.push(fact);
        }
      }
      return out;
    },

    size() {
      return byId.size;
    },

    clear() {
      byId.clear();
      byIdempotency.clear();
      order.length = 0;
    },
  };
}

export const defaultPersonalKnowledgeStore = createPersonalKnowledgeStore();

export function resetPersonalKnowledgeStoreForTests() {
  defaultPersonalKnowledgeStore.clear();
}
