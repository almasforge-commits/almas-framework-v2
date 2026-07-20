/**
 * Bounded in-memory Reasoning store (insights + recommendations).
 * Actor-scoped. Injectable. Deterministic FIFO eviction.
 */

import {
  buildInsightIdempotencyKey,
  normalizeInsightText,
} from "./reasoningContracts.js";

const DEFAULT_MAX_ENTRIES = 1000;

/**
 * @param {object} [options]
 */
export function createReasoningStore(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries)
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES;

  /** @type {Map<string, object>} */
  const insightsById = new Map();
  /** @type {Map<string, string>} */
  const insightIdempotency = new Map();
  /** @type {string[]} */
  const insightOrder = [];

  /** @type {Map<string, object>} */
  const recsById = new Map();
  /** @type {Map<string, string>} */
  const recIdempotency = new Map();
  /** @type {string[]} */
  const recOrder = [];

  function requireActor(actorKey) {
    const key = String(actorKey ?? "").trim();
    if (!key) throw new Error("reasoning_store_missing_actor_key");
    return key;
  }

  function evict(map, order, idemMap) {
    while (map.size > maxEntries && order.length > 0) {
      const oldest = order.shift();
      const row = map.get(oldest);
      if (!row) continue;
      map.delete(oldest);
      if (row.idempotencyKey) idemMap.delete(row.idempotencyKey);
    }
  }

  function touch(order, id) {
    const idx = order.indexOf(id);
    if (idx >= 0) order.splice(idx, 1);
    order.push(id);
  }

  return {
    upsertInsight(insight) {
      const actorKey = requireActor(insight.actorKey);
      const idem =
        insight.idempotencyKey ||
        buildInsightIdempotencyKey(
          actorKey,
          insight.type,
          insight.normalizedTitle || normalizeInsightText(insight.title),
          insight.requestKey
        );
      const existingId = insightIdempotency.get(idem);
      if (existingId) {
        const existing = insightsById.get(existingId);
        if (existing && existing.actorKey !== actorKey) {
          throw new Error("reasoning_store_actor_mismatch");
        }
        const updated = {
          ...existing,
          ...insight,
          id: existing.id,
          actorKey,
          idempotencyKey: idem,
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        };
        insightsById.set(existing.id, updated);
        touch(insightOrder, existing.id);
        return { insight: updated, created: false };
      }

      const id =
        insight.id ||
        `ins_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created = {
        ...insight,
        id,
        actorKey,
        idempotencyKey: idem,
        createdAt: insight.createdAt ?? Date.now(),
        updatedAt: insight.updatedAt ?? Date.now(),
      };
      insightsById.set(id, created);
      insightIdempotency.set(idem, id);
      touch(insightOrder, id);
      evict(insightsById, insightOrder, insightIdempotency);
      return { insight: created, created: true };
    },

    getInsight(actorKey, id) {
      const key = requireActor(actorKey);
      const row = insightsById.get(id);
      if (!row || row.actorKey !== key) return null;
      return row;
    },

    listInsights(actorKey, opts = {}) {
      const key = requireActor(actorKey);
      return filterRows(insightsById, insightOrder, key, opts);
    },

    searchInsights(actorKey, query, opts = {}) {
      const key = requireActor(actorKey);
      const q = normalizeInsightText(query);
      if (!q) return [];
      return filterRows(insightsById, insightOrder, key, opts).filter(
        (row) =>
          normalizeInsightText(row.title).includes(q) ||
          normalizeInsightText(row.description).includes(q)
      );
    },

    deleteInsight(actorKey, id) {
      const key = requireActor(actorKey);
      const row = insightsById.get(id);
      if (!row || row.actorKey !== key) return false;
      insightsById.delete(id);
      if (row.idempotencyKey) insightIdempotency.delete(row.idempotencyKey);
      const idx = insightOrder.indexOf(id);
      if (idx >= 0) insightOrder.splice(idx, 1);
      return true;
    },

    upsertRecommendation(rec) {
      const actorKey = requireActor(rec.actorKey);
      const idem =
        rec.idempotencyKey ||
        buildInsightIdempotencyKey(
          actorKey,
          `rec:${(rec.insightIds || []).join(",")}`,
          normalizeInsightText(rec.title),
          rec.requestKey
        );
      const existingId = recIdempotency.get(idem);
      if (existingId) {
        const existing = recsById.get(existingId);
        if (existing && existing.actorKey !== actorKey) {
          throw new Error("reasoning_store_actor_mismatch");
        }
        const updated = {
          ...existing,
          ...rec,
          id: existing.id,
          actorKey,
          idempotencyKey: idem,
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        };
        recsById.set(existing.id, updated);
        touch(recOrder, existing.id);
        return { recommendation: updated, created: false };
      }

      const id =
        rec.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created = {
        ...rec,
        id,
        actorKey,
        idempotencyKey: idem,
        createdAt: rec.createdAt ?? Date.now(),
        updatedAt: rec.updatedAt ?? Date.now(),
      };
      recsById.set(id, created);
      recIdempotency.set(idem, id);
      touch(recOrder, id);
      evict(recsById, recOrder, recIdempotency);
      return { recommendation: created, created: true };
    },

    listRecommendations(actorKey, opts = {}) {
      const key = requireActor(actorKey);
      return filterRows(recsById, recOrder, key, opts);
    },

    searchRecommendations(actorKey, query, opts = {}) {
      const key = requireActor(actorKey);
      const q = normalizeInsightText(query);
      if (!q) return [];
      return filterRows(recsById, recOrder, key, opts).filter(
        (row) =>
          normalizeInsightText(row.title).includes(q) ||
          normalizeInsightText(row.description).includes(q)
      );
    },

    clear(actorKey) {
      if (actorKey == null || actorKey === "") {
        insightsById.clear();
        insightIdempotency.clear();
        insightOrder.length = 0;
        recsById.clear();
        recIdempotency.clear();
        recOrder.length = 0;
        return;
      }
      const key = requireActor(actorKey);
      for (const [id, row] of [...insightsById.entries()]) {
        if (row.actorKey !== key) continue;
        insightsById.delete(id);
        if (row.idempotencyKey) insightIdempotency.delete(row.idempotencyKey);
        const idx = insightOrder.indexOf(id);
        if (idx >= 0) insightOrder.splice(idx, 1);
      }
      for (const [id, row] of [...recsById.entries()]) {
        if (row.actorKey !== key) continue;
        recsById.delete(id);
        if (row.idempotencyKey) recIdempotency.delete(row.idempotencyKey);
        const idx = recOrder.indexOf(id);
        if (idx >= 0) recOrder.splice(idx, 1);
      }
    },

    size() {
      return { insights: insightsById.size, recommendations: recsById.size };
    },
  };
}

function filterRows(map, order, actorKey, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 50;
  const minConfidence = Number.isFinite(opts.minConfidence)
    ? opts.minConfidence
    : null;
  const type = opts.type || null;
  const domain = opts.domain || null;
  const since = Number.isFinite(opts.since) ? opts.since : null;
  const out = [];

  for (let i = order.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const row = map.get(order[i]);
    if (!row || row.actorKey !== actorKey) continue;
    if (row.status && row.status !== "active" && opts.includeInactive !== true) {
      continue;
    }
    if (type && row.type !== type) continue;
    if (
      minConfidence != null &&
      !(Number(row.confidence) >= minConfidence)
    ) {
      continue;
    }
    if (domain) {
      const domains = row.relatedDomains || [];
      if (!domains.includes(domain)) continue;
    }
    if (since != null && !(Number(row.createdAt) >= since)) continue;
    out.push(row);
  }
  return out;
}

export const defaultReasoningStore = createReasoningStore();

export function resetReasoningStoreForTests() {
  defaultReasoningStore.clear();
}
