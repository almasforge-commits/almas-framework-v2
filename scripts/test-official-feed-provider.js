/**
 * D-029 — Official RSS/Atom World Knowledge provider tests.
 * Injected fake fetch + XML fixtures only. No real internet.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateFeedRegistry,
  getWorldKnowledgeFeeds,
  DEFAULT_WORLD_KNOWLEDGE_FEEDS,
} from "../config/worldKnowledgeFeeds.js";
import {
  createOfficialFeedProvider,
  OFFICIAL_FEED_PROVIDER_ID,
} from "../services/worldKnowledge/providers/officialFeedProvider.js";
import { parseFeedXml, sanitizeFeedText } from "../services/worldKnowledge/providers/feedXmlParser.js";
import {
  assertFeedUrlAllowed,
  rejectUserSuppliedFeedUrl,
} from "../services/worldKnowledge/providers/feedUrlGuard.js";
import {
  createIsolatedWorldKnowledgeGateway,
} from "../services/worldKnowledge/worldKnowledgeGateway.js";
import { createWorldKnowledgeForTelegram } from "../services/worldKnowledge/worldKnowledgeFactory.js";
import { createTelegramAnswerEngineWithWorld } from "../services/answer/telegramAnswerFactory.js";
import { formatTelegramAnswerReply } from "../services/answer/formatTelegramAnswer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err);
    failed += 1;
  }
}

const NOW = Date.parse("2026-07-20T12:00:00Z");

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Official Example News</title>
    <item>
      <title>Kubernetes security update</title>
      <link>https://feeds.example.invalid/news/k8s</link>
      <description><![CDATA[<p>Cluster <b>Kubernetes</b> patch released.</p><script>alert(1)</script>]]></description>
      <pubDate>Mon, 15 Jul 2026 10:00:00 GMT</pubDate>
      <author>sec@example.invalid</author>
      <guid>rss-k8s-1</guid>
    </item>
    <item>
      <title>Unrelated gardening tips</title>
      <link>https://feeds.example.invalid/news/garden</link>
      <description>How to water tomatoes</description>
      <pubDate>Mon, 14 Jul 2026 10:00:00 GMT</pubDate>
      <guid>rss-garden-1</guid>
    </item>
    <item>
      <title>Old Kubernetes note</title>
      <link>https://feeds.example.invalid/news/old-k8s</link>
      <description>Ancient Kubernetes article</description>
      <pubDate>Mon, 01 Jan 2020 10:00:00 GMT</pubDate>
      <guid>rss-old-1</guid>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Official Docs Atom</title>
  <entry>
    <title>MCP protocol overview</title>
    <link href="https://feeds.example.invalid/atom/mcp" rel="alternate"/>
    <id>atom-mcp-1</id>
    <updated>2026-07-18T09:00:00Z</updated>
    <summary>Model Context Protocol (MCP) primer for developers.</summary>
    <author><name>Docs Team</name></author>
  </entry>
  <entry>
    <title>Billing FAQ</title>
    <link href="https://feeds.example.invalid/atom/billing"/>
    <id>atom-bill-1</id>
    <published>2026-07-17T09:00:00Z</published>
    <content type="html">How invoices work</content>
  </entry>
</feed>`;

function fixtureFeeds() {
  return validateFeedRegistry([
    {
      id: "example_news",
      title: "Official Example News",
      url: "https://feeds.example.invalid/rss.xml",
      organization: "Example Org",
      sourceType: "news",
      trustScore: 0.8,
      topics: ["kubernetes", "security", "infrastructure"],
      languages: ["en"],
      enabled: true,
    },
    {
      id: "example_docs",
      title: "Official Docs Atom",
      url: "https://feeds.example.invalid/atom.xml",
      organization: "Example Docs",
      sourceType: "documentation",
      trustScore: 0.85,
      topics: ["mcp", "protocols"],
      languages: ["en"],
      enabled: true,
    },
  ]);
}

function makeFetch(map, { delayMs = 0, oversized = false } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      headers: init.headers || {},
      hasAuth: Boolean(init.headers?.Authorization || init.headers?.authorization),
      hasCookie: Boolean(init.headers?.Cookie || init.headers?.cookie),
    });

    const signal = init.signal;
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }

    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    const entry = map[String(url)];
    if (!entry) {
      return {
        ok: false,
        status: 404,
        url: String(url),
        headers: { get: () => "application/xml" },
        text: async () => "",
        body: null,
      };
    }
    if (entry.throwCode) {
      const err = new Error(entry.throwCode);
      err.name = entry.throwCode === "feed_timeout" ? "AbortError" : "Error";
      throw err;
    }
    let body = entry.body;
    if (oversized || entry.oversized) {
      body = "x".repeat(600_000);
    }
    const contentType = entry.contentType || "application/rss+xml";
    const encoded = Buffer.from(body, "utf8");
    return {
      ok: entry.ok !== false,
      status: entry.status || 200,
      url: entry.finalUrl || String(url),
      headers: {
        get: (name) =>
          String(name).toLowerCase() === "content-type" ? contentType : null,
      },
      text: async () => body,
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: encoded };
            },
            async cancel() {},
          };
        },
      },
    };
  };
  fetchFn.calls = calls;
  return fetchFn;
}

async function createReadyProvider(overrides = {}) {
  const fetchFn =
    overrides.fetchFn ||
    makeFetch({
      "https://feeds.example.invalid/rss.xml": {
        body: RSS_FIXTURE,
        contentType: "application/rss+xml",
      },
      "https://feeds.example.invalid/atom.xml": {
        body: ATOM_FIXTURE,
        contentType: "application/atom+xml",
      },
    });
  const provider = createOfficialFeedProvider({
    feeds: overrides.feeds || fixtureFeeds(),
    fetchFn,
    nowFn: overrides.nowFn || (() => NOW),
    env: overrides.env || {},
    config: {
      feedTimeoutMs: 200,
      feedMaxBytes: 100_000,
      feedMaxItems: overrides.feedMaxItems || 8,
      feedMaxAgeDays: overrides.feedMaxAgeDays || 30,
      ...(overrides.config || {}),
    },
    logger: overrides.logger || { log() {}, error() {} },
    allowIpHosts: overrides.allowIpHosts === true,
    feedCache: overrides.feedCache,
  });
  await provider.initialize();
  return { provider, fetchFn };
}

await test("0. default feed registry is empty (no invented URLs)", async () => {
  assert.equal(DEFAULT_WORLD_KNOWLEDGE_FEEDS.length, 0);
  assert.equal(getWorldKnowledgeFeeds().length, 0);
});

await test("1. Valid RSS 2.0 parsing", async () => {
  const parsed = parseFeedXml(RSS_FIXTURE);
  assert.equal(parsed.format, "rss");
  assert.match(parsed.title, /Official Example News/);
  assert.ok(parsed.entries.length >= 2);
  assert.match(parsed.entries[0].title, /Kubernetes/i);
  assert.ok(parsed.entries[0].url.includes("https://"));
  assert.ok(Number.isFinite(parsed.entries[0].publishedAt));
});

await test("2. Valid Atom parsing", async () => {
  const parsed = parseFeedXml(ATOM_FIXTURE);
  assert.equal(parsed.format, "atom");
  assert.match(parsed.entries[0].title, /MCP/i);
  assert.equal(parsed.entries[0].url, "https://feeds.example.invalid/atom/mcp");
  assert.match(parsed.entries[0].author, /Docs Team/);
});

await test("3. Query relevance filtering", async () => {
  const { provider } = await createReadyProvider();
  const rows = await provider.search("Kubernetes security");
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => /kubernetes/i.test(r.title + r.summary)));
  assert.ok(!rows.some((r) => /gardening/i.test(r.title)));
});

await test("4. Stable ranking/order", async () => {
  const { provider } = await createReadyProvider();
  const a = await provider.search("Kubernetes");
  const b = await provider.search("Kubernetes");
  assert.deepEqual(
    a.map((r) => r.metadata.entryId),
    b.map((r) => r.metadata.entryId)
  );
});

await test("5. HTML sanitization from descriptions", async () => {
  assert.equal(sanitizeFeedText("<script>x</script>Hello <b>World</b>"), "Hello World");
  const { provider } = await createReadyProvider();
  const rows = await provider.search("Kubernetes");
  assert.ok(rows.length);
  assert.ok(!/<|>|script/i.test(rows[0].summary));
  assert.match(rows[0].summary, /Kubernetes/i);
});

await test("6. Provenance preserved", async () => {
  const { provider } = await createReadyProvider();
  const rows = await provider.search("Kubernetes");
  const r = rows[0];
  assert.equal(r.provider, OFFICIAL_FEED_PROVIDER_ID);
  assert.ok(r.url);
  assert.ok(r.sourceType);
  assert.ok(r.metadata.feedId);
  assert.ok(r.metadata.organization);
  assert.ok(r.metadata.entryId);
  assert.equal(typeof r.confidence, "number");
});

await test("7. HTTPS allowlist enforced", async () => {
  assert.equal(
    assertFeedUrlAllowed("http://feeds.example.invalid/rss.xml", {
      allowlist: ["https://feeds.example.invalid/rss.xml"],
    }).ok,
    false
  );
  assert.equal(
    assertFeedUrlAllowed("https://evil.example.invalid/rss.xml", {
      allowlist: ["https://feeds.example.invalid/rss.xml"],
    }).ok,
    false
  );
  assert.equal(
    assertFeedUrlAllowed("https://feeds.example.invalid/rss.xml", {
      allowlist: ["https://feeds.example.invalid/rss.xml"],
    }).ok,
    true
  );
});

await test("8. Arbitrary user URL rejected", async () => {
  const { provider, fetchFn } = await createReadyProvider();
  const before = fetchFn.calls.length;
  const rows = await provider.search("Kubernetes", {
    feedUrl: "https://attacker.example.invalid/x.xml",
  });
  assert.deepEqual(rows, []);
  assert.equal(fetchFn.calls.length, before);
  assert.equal(rejectUserSuppliedFeedUrl("https://x").ok, false);
});

await test("9. localhost/private address rejected", async () => {
  for (const url of [
    "https://localhost/feed.xml",
    "https://127.0.0.1/feed.xml",
    "https://192.168.1.1/feed.xml",
    "https://10.0.0.2/feed.xml",
    "https://169.254.169.254/latest",
  ]) {
    assert.equal(
      assertFeedUrlAllowed(url, { allowlist: [url] }).ok,
      false,
      url
    );
  }
});

await test("10. Oversized response rejected", async () => {
  const fetchFn = makeFetch(
    {
      "https://feeds.example.invalid/rss.xml": {
        body: "tiny",
        contentType: "application/rss+xml",
        oversized: true,
      },
    },
    { oversized: true }
  );
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
    config: { feedMaxBytes: 1000 },
  });
  const rows = await provider.search("Kubernetes");
  assert.equal(rows.length, 0);
  assert.ok(
    provider._getLastErrors().some((e) => e.reason === "feed_too_large")
  );
});

await test("11. Timeout handled", async () => {
  const fetchFn = makeFetch(
    {
      "https://feeds.example.invalid/rss.xml": {
        body: RSS_FIXTURE,
        contentType: "application/rss+xml",
      },
    },
    { delayMs: 250 }
  );
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
    config: { feedTimeoutMs: 40 },
  });
  const rows = await provider.search("Kubernetes");
  assert.equal(rows.length, 0);
  assert.ok(
    provider._getLastErrors().some((e) => e.reason === "feed_timeout")
  );
});

await test("12. Malformed XML handled safely", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: "<not-a-feed>garbage",
      contentType: "application/xml",
    },
  });
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
  });
  const rows = await provider.search("Kubernetes");
  assert.equal(rows.length, 0);
  assert.ok(
    provider._getLastErrors().some((e) => e.reason === "feed_parse_failed")
  );
});

await test("13. Invalid content type rejected", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: "<html><body>hi</body></html>",
      contentType: "text/html",
    },
  });
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
  });
  const rows = await provider.search("Kubernetes");
  assert.equal(rows.length, 0);
  assert.ok(
    provider
      ._getLastErrors()
      .some((e) => e.reason === "feed_invalid_content_type")
  );
});

await test("14. One failed feed does not break other feeds", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: "nope",
      contentType: "text/html",
      ok: false,
      status: 500,
    },
    "https://feeds.example.invalid/atom.xml": {
      body: ATOM_FIXTURE,
      contentType: "application/atom+xml",
    },
  });
  const { provider } = await createReadyProvider({ fetchFn });
  const rows = await provider.search("MCP protocol");
  assert.ok(rows.some((r) => /MCP/i.test(r.title)));
});

await test("15. Duplicate entries deduplicated by Gateway", async () => {
  const dupRss = `<?xml version="1.0"?><rss version="2.0"><channel><title>A</title>
    <item><title>Same Kubernetes item</title><link>https://feeds.example.invalid/same</link>
    <description>Kubernetes duplicate</description><pubDate>Mon, 15 Jul 2026 10:00:00 GMT</pubDate><guid>same-1</guid></item>
    <item><title>Same Kubernetes item</title><link>https://feeds.example.invalid/same</link>
    <description>Kubernetes duplicate</description><pubDate>Mon, 15 Jul 2026 10:00:00 GMT</pubDate><guid>same-1</guid></item>
  </channel></rss>`;
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: dupRss,
      contentType: "application/rss+xml",
    },
  });
  const provider = createOfficialFeedProvider({
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
    fetchFn,
    nowFn: () => NOW,
    config: { feedMaxAgeDays: 30, feedMaxItems: 10, feedMaxBytes: 100000, feedTimeoutMs: 200 },
  });
  await provider.initialize();
  const gw = createIsolatedWorldKnowledgeGateway({ cache: null });
  await gw.initializeProviders([provider]);
  const result = await gw.search("Kubernetes", { forceEnabled: true });
  const urls = result.results.map((r) => r.url);
  assert.equal(new Set(urls).size, urls.length);
});

await test("16. Old entries filtered by max age", async () => {
  const { provider } = await createReadyProvider({ feedMaxAgeDays: 30 });
  const rows = await provider.search("Kubernetes");
  assert.ok(!rows.some((r) => /Old Kubernetes/i.test(r.title)));
});

await test("17. Result count capped", async () => {
  const manyItems = Array.from({ length: 20 }, (_, i) => {
    return `<item><title>Kubernetes update ${i}</title><link>https://feeds.example.invalid/n/${i}</link>
      <description>Kubernetes detail ${i}</description>
      <pubDate>Mon, 15 Jul 2026 10:00:00 GMT</pubDate><guid>k-${i}</guid></item>`;
  }).join("");
  const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>N</title>${manyItems}</channel></rss>`;
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body,
      contentType: "application/rss+xml",
    },
  });
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
    feedMaxItems: 5,
  });
  const rows = await provider.search("Kubernetes");
  assert.ok(rows.length <= 5);
});

await test("18. Provider health behavior", async () => {
  const { provider } = await createReadyProvider();
  const h = await provider.health();
  assert.equal(h.ok, true);
  assert.equal(h.provider, OFFICIAL_FEED_PROVIDER_ID);
  assert.ok(h.enabledFeeds >= 1);
  await provider.shutdown();
  const h2 = await provider.health();
  assert.equal(h2.ok, false);
});

await test("19. Off mode performs zero fetches", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "application/rss+xml",
    },
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: { WORLD_KNOWLEDGE_ENABLED: "false", WORLD_KNOWLEDGE_MODE: "off" },
    feeds: fixtureFeeds(),
    fetchFn,
  });
  assert.equal(wk.gateway, null);
  assert.equal(fetchFn.calls.length, 0);
});

await test("20. Shadow mode does not alter Telegram answer", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "application/rss+xml",
    },
    "https://feeds.example.invalid/atom.xml": {
      body: ATOM_FIXTURE,
      contentType: "application/atom+xml",
    },
  });
  const envShadow = {
    WORLD_KNOWLEDGE_ENABLED: "true",
    WORLD_KNOWLEDGE_MODE: "shadow",
  };
  const envOff = {
    WORLD_KNOWLEDGE_ENABLED: "false",
    WORLD_KNOWLEDGE_MODE: "off",
  };
  const common = {
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  };
  const off = await createTelegramAnswerEngineWithWorld({
    env: envOff,
    ...common,
  });
  const shadowWk = await createWorldKnowledgeForTelegram({
    env: envShadow,
    feeds: fixtureFeeds(),
    fetchFn,
    onAudit: () => {},
  });
  const shadow = await createTelegramAnswerEngineWithWorld({
    env: envShadow,
    worldKnowledge: shadowWk,
    worldKnowledgeGateway: shadowWk.gateway,
    ...common,
  });
  const q = {
    actorKey: "telegram:1",
    query: "What is Kubernetes?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  };
  const a = formatTelegramAnswerReply(await off.engine.answer(q));
  const b = formatTelegramAnswerReply(await shadow.engine.answer(q));
  assert.equal(a, b);
  assert.ok(fetchFn.calls.length >= 1);
});

await test("21. Active mode can return normalized world evidence", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "application/rss+xml",
    },
    "https://feeds.example.invalid/atom.xml": {
      body: ATOM_FIXTURE,
      contentType: "application/atom+xml",
    },
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: {
      WORLD_KNOWLEDGE_ENABLED: "true",
      WORLD_KNOWLEDGE_MODE: "active",
    },
    feeds: fixtureFeeds(),
    fetchFn,
  });
  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: {
      WORLD_KNOWLEDGE_ENABLED: "true",
      WORLD_KNOWLEDGE_MODE: "active",
    },
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });
  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "What is Kubernetes?",
    planOverrides: { includeDomains: false, includeReasoning: false },
  });
  assert.equal(result.usedWorldKnowledge, true);
  assert.ok(result.worldSources?.length);
  assert.ok(result.worldSources[0].provider);
  assert.ok(result.worldSources[0].url);
});

await test("22. Personal-only questions skip provider", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "application/rss+xml",
    },
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: {
      WORLD_KNOWLEDGE_ENABLED: "true",
      WORLD_KNOWLEDGE_MODE: "active",
    },
    feeds: fixtureFeeds(),
    fetchFn,
  });
  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: {
      WORLD_KNOWLEDGE_ENABLED: "true",
      WORLD_KNOWLEDGE_MODE: "active",
    },
    worldKnowledgeGateway: wk.gateway,
    retrievePersonal: async () => [
      {
        id: "t1",
        content: "You have open tasks.",
        confidence: 0.9,
        domain: "Tasks",
      },
    ],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [{ id: 1, text: "x" }],
    searchKnowledgeFn: async () => [],
    searchMemoryFn: async () => [],
  });
  await engine.answer({ actorKey: "telegram:1", query: "My tasks" });
  assert.equal(fetchFn.calls.length, 0);
});

await test("23. No Personal Knowledge or Memory writes", async () => {
  let writes = 0;
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "application/rss+xml",
    },
    "https://feeds.example.invalid/atom.xml": {
      body: ATOM_FIXTURE,
      contentType: "application/atom+xml",
    },
  });
  const wk = await createWorldKnowledgeForTelegram({
    env: {
      WORLD_KNOWLEDGE_ENABLED: "true",
      WORLD_KNOWLEDGE_MODE: "active",
    },
    feeds: fixtureFeeds(),
    fetchFn,
  });
  const { engine } = await createTelegramAnswerEngineWithWorld({
    env: {
      WORLD_KNOWLEDGE_ENABLED: "true",
      WORLD_KNOWLEDGE_MODE: "active",
    },
    worldKnowledgeGateway: wk.gateway,
    personalKnowledgeEngine: {
      retrieve: async () => [],
      ingest: async () => {
        writes += 1;
      },
      upsertFact: async () => {
        writes += 1;
      },
    },
    searchMemoryFn: async () => {
      writes += 1;
      return [];
    },
    retrievePersonal: async () => [],
    getFinanceSnapshot: async () => null,
    getTasksSnapshot: async () => [],
    searchKnowledgeFn: async () => [],
  });
  await engine.answer({
    actorKey: "telegram:1",
    query: "What is Kubernetes?",
    planOverrides: {
      includeDomains: false,
      includeReasoning: false,
      includeMemory: false,
    },
  });
  assert.equal(writes, 0);
});

await test("24. No Telegram user data sent to feeds", async () => {
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "application/rss+xml",
    },
  });
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
  });
  await provider.search("Kubernetes for telegram:999 chat 42");
  assert.ok(fetchFn.calls.length >= 1);
  for (const c of fetchFn.calls) {
    assert.equal(c.hasAuth, false);
    assert.equal(c.hasCookie, false);
    assert.ok(!/telegram:|chat/i.test(c.url));
    assert.equal(c.url, "https://feeds.example.invalid/rss.xml");
  }
});

await test("25. No raw feed payload in logs", async () => {
  const lines = [];
  const fetchFn = makeFetch({
    "https://feeds.example.invalid/rss.xml": {
      body: RSS_FIXTURE,
      contentType: "text/html",
      ok: false,
    },
  });
  const { provider } = await createReadyProvider({
    fetchFn,
    feeds: fixtureFeeds().filter((f) => f.id === "example_news"),
    logger: {
      log: (s) => lines.push(String(s)),
      error: (s) => lines.push(String(s)),
    },
  });
  await provider.search("Kubernetes");
  const blob = lines.join("\n");
  assert.ok(!/Cluster/i.test(blob));
  assert.ok(!/<rss/i.test(blob));
  assert.ok(!/feeds\.example\.invalid\/news/i.test(blob));
  assert.match(blob, /feed_failed reason=/);
});

await test("registry rejects duplicate ids/urls and non-https", async () => {
  assert.throws(() =>
    validateFeedRegistry([
      {
        id: "a",
        title: "A",
        url: "https://a.example.invalid/x",
        organization: "O",
        sourceType: "news",
        enabled: true,
      },
      {
        id: "a",
        title: "B",
        url: "https://b.example.invalid/x",
        organization: "O",
        sourceType: "news",
        enabled: true,
      },
    ])
  );
  assert.throws(() =>
    validateFeedRegistry([
      {
        id: "a",
        title: "A",
        url: "http://a.example.invalid/x",
        organization: "O",
        sourceType: "news",
        enabled: true,
      },
    ])
  );
});

console.log(`\nofficial-feed-provider: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
