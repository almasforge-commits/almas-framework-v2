/**
 * Deterministic mock / static world knowledge providers.
 * No HTTP. No internet. Architecture placeholders only.
 */

import { createProviderResult } from "./providerContracts.js";

function baseProvider(id, sourceType, catalog) {
  let ready = false;
  return {
    id,
    async initialize() {
      ready = true;
    },
    async health() {
      return { ok: ready, provider: id };
    },
    async shutdown() {
      ready = false;
    },
    /**
     * @param {string} query
     * @param {object} [options]
     */
    async search(query, options = {}) {
      if (!ready) {
        const err = new Error("provider_unavailable");
        err.code = "provider_unavailable";
        err.provider = id;
        throw err;
      }
      const q = String(query ?? "")
        .trim()
        .toLowerCase();
      const limit = Number.isFinite(options.limit) ? options.limit : 5;
      const rows = catalog.filter((row) => {
        if (!q) return true;
        const hay = `${row.title} ${row.summary}`.toLowerCase();
        return hay.includes(q) || q.split(/\s+/).some((t) => t && hay.includes(t));
      });
      return rows.slice(0, limit).map((row) =>
        createProviderResult({
          ...row,
          provider: id,
          sourceType: row.sourceType || sourceType,
        })
      );
    },
  };
}

export function createStaticProvider() {
  return baseProvider("static", "web", [
    {
      title: "Static World Fact: Bangkok",
      summary: "Bangkok is the capital of Thailand.",
      url: "https://example.invalid/static/bangkok",
      publishedAt: Date.parse("2020-01-01T00:00:00Z"),
      language: "en",
      author: "StaticProvider",
      confidence: 0.6,
      sourceType: "web",
      metadata: { quality: 0.5 },
    },
    {
      title: "Static World Fact: WHOOP",
      summary: "WHOOP is a wearable fitness tracker brand.",
      url: "https://example.invalid/static/whoop",
      publishedAt: Date.parse("2021-06-01T00:00:00Z"),
      language: "en",
      author: "StaticProvider",
      confidence: 0.55,
      sourceType: "web",
      metadata: { quality: 0.4 },
    },
  ]);
}

export function createMockNewsProvider() {
  return baseProvider("mock_news", "news", [
    {
      title: "Mock News: Recovery trends",
      summary: "Analysts discuss wearable recovery metrics including WHOOP.",
      url: "https://example.invalid/news/recovery",
      publishedAt: Date.parse("2024-11-01T00:00:00Z"),
      language: "en",
      author: "MockNews",
      confidence: 0.5,
      sourceType: "news",
      metadata: { quality: 0.6 },
    },
    {
      title: "Mock News: AI knowledge systems",
      summary: "Enterprise interest grows in personal knowledge engines.",
      url: "https://example.invalid/news/ai-knowledge",
      publishedAt: Date.parse("2025-01-15T00:00:00Z"),
      language: "en",
      author: "MockNews",
      confidence: 0.52,
      sourceType: "news",
      metadata: { quality: 0.55 },
    },
  ]);
}

export function createMockResearchProvider() {
  return baseProvider("mock_research", "research", [
    {
      title: "Mock Research: Retrieval ranking",
      summary:
        "Evidence ranking improves answer quality when personal and world sources are separated.",
      url: "https://example.invalid/research/ranking",
      publishedAt: Date.parse("2023-05-01T00:00:00Z"),
      language: "en",
      author: "MockLab",
      confidence: 0.72,
      sourceType: "research",
      metadata: { quality: 0.8 },
    },
    {
      title: "Mock Research: WHOOP HRV",
      summary: "Heart-rate variability correlates with recovery scores in wearables.",
      url: "https://example.invalid/research/whoop-hrv",
      publishedAt: Date.parse("2022-09-10T00:00:00Z"),
      language: "en",
      author: "MockLab",
      confidence: 0.7,
      sourceType: "research",
      metadata: { quality: 0.75 },
    },
  ]);
}

export function createMockDocumentationProvider() {
  return baseProvider("mock_documentation", "documentation", [
    {
      title: "Mock Docs: ALMAS World Knowledge",
      summary:
        "World knowledge is external, provenance-required, and never stored as personal facts.",
      url: "https://example.invalid/docs/world-knowledge",
      publishedAt: Date.parse("2025-06-01T00:00:00Z"),
      language: "en",
      author: "ALMAS Docs",
      confidence: 0.8,
      sourceType: "documentation",
      metadata: { quality: 0.9 },
    },
    {
      title: "Mock Docs: Provider interface",
      summary: "Providers must implement initialize, search, health, and shutdown.",
      url: "https://example.invalid/docs/provider-interface",
      publishedAt: Date.parse("2025-06-01T00:00:00Z"),
      language: "en",
      author: "ALMAS Docs",
      confidence: 0.78,
      sourceType: "documentation",
      metadata: { quality: 0.85 },
    },
  ]);
}

/**
 * Register the four placeholder providers on a manager.
 * @param {object} manager
 */
export async function registerDefaultMockProviders(manager) {
  await manager.registerProvider(createStaticProvider());
  await manager.registerProvider(createMockNewsProvider());
  await manager.registerProvider(createMockResearchProvider());
  await manager.registerProvider(createMockDocumentationProvider());
}
