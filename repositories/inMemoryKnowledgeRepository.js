/**
 * In-memory Knowledge repository for ingestion shadow/dry_run tests.
 */

import { assertKnowledgeRepository } from "./knowledgeRepository.js";

/**
 * @param {object} [options]
 */
export function createInMemoryKnowledgeRepository(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries)
    ? options.maxEntries
    : 2000;
  /** @type {Map<string, object>} */
  const byId = new Map();

  const repo = {
    async upsert(record) {
      const id = String(record?.id || "").trim();
      if (!id) throw new Error("knowledge_repository_missing_id");
      const existing = byId.get(id);
      const now = Date.now();
      const saved = {
        ...existing,
        ...record,
        id,
        updatedAt: now,
        createdAt: existing?.createdAt ?? record.createdAt ?? now,
        shadow: record.shadow !== false,
      };
      byId.set(id, saved);
      while (byId.size > maxEntries) {
        const oldest = byId.keys().next().value;
        byId.delete(oldest);
      }
      return { record: saved, created: !existing };
    },

    async getById(id) {
      return byId.get(String(id)) || null;
    },

    async list(opts = {}) {
      const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
      return [...byId.values()]
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limit);
    },

    async clear() {
      byId.clear();
    },

    async size() {
      return byId.size;
    },
  };

  return assertKnowledgeRepository(repo);
}
