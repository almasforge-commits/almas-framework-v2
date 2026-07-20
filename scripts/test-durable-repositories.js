/**
 * Durable Personal Knowledge + Reasoning repository tests.
 * Uses mocks — does not hit live Supabase. Does not apply migrations.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPersonalKnowledgeRepository,
  assertReasoningRepository,
  createInMemoryPersonalKnowledgeRepository,
  createInMemoryReasoningRepository,
  isPersonalKnowledgeRepository,
  isReasoningRepository,
} from "../repositories/index.js";
import {
  createSupabasePersonalKnowledgeRepository,
  toPersonalKnowledgeRow,
  fromPersonalKnowledgeRow,
} from "../providers/storage/supabasePersonalKnowledgeRepository.js";
import {
  createSupabaseReasoningRepository,
  toReasoningInsightRow,
  fromReasoningInsightRow,
} from "../providers/storage/supabaseReasoningRepository.js";
import { createPersonalKnowledgeEngine } from "../services/personalKnowledge/personalKnowledgeEngine.js";
import { createReasoningEngine } from "../services/reasoning/reasoningEngine.js";
import { createIsolatedAnswerEngine } from "../services/answer/answerEngine.js";
import { createPersonalFact } from "../services/personalKnowledge/personalKnowledgeContracts.js";

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

/** Minimal chainable Supabase mock with in-memory tables. */
function createMockSupabase() {
  /** @type {Record<string, object[]>} */
  const tables = {
    personal_knowledge: [],
    reasoning_insights: [],
    reasoning_recommendations: [],
  };
  let actorGuc = "";

  function matchesFilter(row, filters) {
    for (const f of filters) {
      if (f.type === "eq" && row[f.col] !== f.val) return false;
      if (f.type === "in" && !f.val.includes(row[f.col])) return false;
      if (f.type === "or") {
        // simplified: always pass; search filters applied in repo after fetch in real life
        // For mock, treat as contains on normalized_content or content
        const q = String(f.val).match(/%([^%]+)%/);
        const needle = q ? q[1].toLowerCase() : "";
        if (needle) {
          const hay = `${row.normalized_content || ""} ${row.content || ""}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
      }
    }
    return true;
  }

  function from(table) {
    const state = {
      table,
      filters: [],
      orderCol: null,
      ascending: false,
      limitN: 1000,
      action: "select",
      payload: null,
      onConflict: null,
      head: false,
      countExact: false,
    };

    const api = {
      select(_cols, opts = {}) {
        // After upsert/insert/delete, `.select()` only means "return rows".
        if (state.action === "select") {
          state.action = "select";
        }
        if (opts.head) state.head = true;
        if (opts.count === "exact") state.countExact = true;
        return api;
      },
      insert(row) {
        state.action = "insert";
        state.payload = row;
        return api;
      },
      upsert(row, opts = {}) {
        state.action = "upsert";
        state.payload = row;
        state.onConflict = opts.onConflict;
        return api;
      },
      delete() {
        state.action = "delete";
        return api;
      },
      eq(col, val) {
        state.filters.push({ type: "eq", col, val });
        return api;
      },
      in(col, val) {
        state.filters.push({ type: "in", col, val });
        return api;
      },
      or(expr) {
        state.filters.push({ type: "or", val: expr });
        return api;
      },
      order(col, opts = {}) {
        state.orderCol = col;
        state.ascending = Boolean(opts.ascending);
        return api;
      },
      limit(n) {
        state.limitN = n;
        return api;
      },
      maybeSingle() {
        return finalize(true);
      },
      single() {
        state._wantSingle = true;
        return finalize(false);
      },
      then(resolve, reject) {
        return finalize(false).then(resolve, reject);
      },
    };

    async function finalize(maybe) {
      const rows = tables[state.table] || [];

      if (state.action === "upsert") {
        const keyCol = state.onConflict || "idempotency_key";
        const incoming = { ...state.payload };
        if (!incoming.id) {
          incoming.id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`;
        }
        const now = new Date().toISOString();
        const idx = rows.findIndex((r) => r[keyCol] === incoming[keyCol]);
        let created = false;
        if (idx >= 0) {
          const prev = rows[idx];
          if (prev.actor_key !== incoming.actor_key) {
            return {
              data: null,
              error: { message: "actor mismatch" },
            };
          }
          rows[idx] = {
            ...prev,
            ...incoming,
            id: prev.id,
            created_at: prev.created_at,
            updated_at: `${now}+upd`,
          };
        } else {
          created = true;
          rows.push({
            ...incoming,
            created_at: now,
            updated_at: now,
          });
        }
        tables[state.table] = rows;
        const saved = rows.find((r) => r[keyCol] === incoming[keyCol]);
        return { data: saved, error: null, _created: created };
      }

      if (state.action === "delete") {
        const keep = rows.filter((r) => !matchesFilter(r, state.filters));
        const removed = rows.filter((r) => matchesFilter(r, state.filters));
        tables[state.table] = keep;
        return { data: removed.map((r) => ({ id: r.id })), error: null, count: removed.length };
      }

      // select
      let list = rows.filter((r) => matchesFilter(r, state.filters));
      if (state.orderCol) {
        list.sort((a, b) => {
          const av = a[state.orderCol];
          const bv = b[state.orderCol];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return state.ascending ? cmp : -cmp;
        });
      }
      list = list.slice(0, state.limitN);

      if (state.head && state.countExact) {
        return { data: null, error: null, count: list.length };
      }

      if (maybe) {
        return { data: list[0] || null, error: null };
      }
      // .single() on a select list
      if (state._wantSingle) {
        return { data: list[0] || null, error: list[0] ? null : { message: "not found" } };
      }
      return { data: list, error: null };
    }

    return api;
  }

  return {
    from,
    rpc: async (name, args) => {
      if (name === "almas_set_actor_key") {
        actorGuc = args?.p_actor_key || "";
        return { data: null, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
    _tables: tables,
    _getActorGuc: () => actorGuc,
  };
}

await test("repository contract — in-memory PK + Reasoning", async () => {
  const pk = createInMemoryPersonalKnowledgeRepository();
  const rs = createInMemoryReasoningRepository();
  assert.equal(isPersonalKnowledgeRepository(pk), true);
  assert.equal(isReasoningRepository(rs), true);
  assertPersonalKnowledgeRepository(pk);
  assertReasoningRepository(rs);
});

await test("Supabase PK repository — upsert idempotency + actor isolation", async () => {
  const sb = createMockSupabase();
  const repo = createSupabasePersonalKnowledgeRepository({ supabase: sb });

  const fact = createPersonalFact({
    actorKey: "telegram:1",
    domain: "Preferences",
    content: "I prefer tea",
    normalizedContent: "i prefer tea",
    confidence: 0.9,
    requestKey: "rk:1",
  });

  const first = await repo.upsert(fact);
  assert.equal(first.created, true);
  const second = await repo.upsert({
    ...fact,
    content: "I prefer tea (updated)",
  });
  assert.equal(second.created, false);
  assert.equal(second.fact.id, first.fact.id);

  const listed = await repo.listByActor("telegram:1");
  assert.equal(listed.length, 1);

  await repo.upsert(
    createPersonalFact({
      actorKey: "telegram:2",
      domain: "Preferences",
      content: "I prefer coffee",
      normalizedContent: "i prefer coffee",
      confidence: 0.9,
      requestKey: "rk:2",
    })
  );

  const a1 = await repo.listByActor("telegram:1");
  const a2 = await repo.listByActor("telegram:2");
  assert.equal(a1.length, 1);
  assert.equal(a2.length, 1);
  assert.ok(a1[0].content.includes("tea"));
  assert.ok(a2[0].content.includes("coffee"));
});

await test("Supabase PK — domain filter + search", async () => {
  const sb = createMockSupabase();
  const repo = createSupabasePersonalKnowledgeRepository({ supabase: sb });

  await repo.upsert(
    createPersonalFact({
      actorKey: "telegram:1",
      domain: "Goals",
      content: "Ship WHOOP integration",
      normalizedContent: "ship whoop integration",
      confidence: 0.9,
      requestKey: "g1",
    })
  );
  await repo.upsert(
    createPersonalFact({
      actorKey: "telegram:1",
      domain: "Preferences",
      content: "Quiet mornings",
      normalizedContent: "quiet mornings",
      confidence: 0.9,
      requestKey: "p1",
    })
  );

  const goals = await repo.listByDomain("telegram:1", "Goals");
  assert.equal(goals.length, 1);
  assert.equal(goals[0].domain, "Goals");

  const found = await repo.search("telegram:1", "whoop");
  assert.ok(found.length >= 1);
  assert.ok(/whoop/i.test(found[0].content));
});

await test("Supabase Reasoning — insight + recommendation persistence", async () => {
  const sb = createMockSupabase();
  const repo = createSupabaseReasoningRepository({ supabase: sb });

  const up = await repo.upsertInsight({
    actorKey: "telegram:1",
    type: "PreferencePattern",
    title: "Prefers quiet mornings",
    description: "Repeated preference",
    confidence: 0.85,
    evidence: [{ factId: "f1", weight: 1, reason: "supporting_fact" }],
    relatedDomains: ["Preferences"],
    relatedFacts: ["f1"],
    requestKey: "req:reasoning:insight:1",
    idempotencyKey: "req:req:reasoning:insight:1",
    status: "active",
  });
  assert.ok(up.insight.id);
  assert.equal(up.insight.title, "Prefers quiet mornings");

  const again = await repo.upsertInsight({
    actorKey: "telegram:1",
    type: "PreferencePattern",
    title: "Prefers quiet mornings",
    description: "Repeated preference updated",
    confidence: 0.9,
    evidence: [{ factId: "f1", weight: 1, reason: "supporting_fact" }],
    relatedDomains: ["Preferences"],
    requestKey: "req:reasoning:insight:1",
    idempotencyKey: "req:req:reasoning:insight:1",
    status: "active",
  });
  assert.equal(again.created, false);
  assert.equal(again.insight.id, up.insight.id);

  const rec = await repo.upsertRecommendation({
    actorKey: "telegram:1",
    title: "Schedule deep work early",
    description: "Based on insight",
    insightIds: [up.insight.id],
    confidence: 0.8,
    requestKey: "req:reasoning:rec:1",
    idempotencyKey: "req:req:reasoning:rec:1",
    status: "active",
  });
  assert.ok(rec.recommendation.id);

  const insights = await repo.listInsights("telegram:1");
  const recs = await repo.listRecommendations("telegram:1");
  assert.equal(insights.length, 1);
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].insightIds, [up.insight.id]);
});

await test("row mappers round-trip", async () => {
  const fact = createPersonalFact({
    actorKey: "telegram:9",
    domain: "Ideas",
    content: "Note",
    normalizedContent: "note",
    confidence: 0.7,
    sourceType: "user_text",
    requestKey: "x",
  });
  const row = toPersonalKnowledgeRow({
    ...fact,
    idempotencyKey: "idem-x",
  });
  assert.equal(row.actor_key, "telegram:9");
  assert.equal(row.telegram_user_id, 9);
  const back = fromPersonalKnowledgeRow({
    ...row,
    id: "00000000-0000-4000-8000-000000000099",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert.equal(back.actorKey, "telegram:9");
  assert.equal(back.domain, "Ideas");

  const insightRow = toReasoningInsightRow({
    actorKey: "telegram:1",
    type: "PreferencePattern",
    title: "T",
    description: "D",
    confidence: 0.5,
    evidence: [],
    relatedDomains: ["Preferences"],
    idempotencyKey: "i1",
  });
  const insight = fromReasoningInsightRow({
    ...insightRow,
    id: "00000000-0000-4000-8000-000000000001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert.equal(insight.title, "T");
  assert.equal(insight.description, "D");
});

await test("repository injection — PK + Reasoning engines", async () => {
  const sb = createMockSupabase();
  const pkRepo = createSupabasePersonalKnowledgeRepository({ supabase: sb });
  const rsRepo = createSupabaseReasoningRepository({ supabase: sb });

  const pkEngine = createPersonalKnowledgeEngine({
    repository: pkRepo,
    config: { enabled: true, confidenceThreshold: 0.5 },
  });

  const ingest = await pkEngine.ingest({
    actorKey: "telegram:1",
    text: "Я хочу выучить TypeScript",
    domainHint: "Goals",
    confidenceHint: 0.95,
    requestKey: "ingest-1",
    candidate: { kind: "goal", text: "Я хочу выучить TypeScript" },
  });
  assert.equal(ingest.ok, true);
  assert.equal(ingest.fact.domain, "Goals");

  const retrieved = await pkEngine.retrieve({
    actorKey: "telegram:1",
    query: "TypeScript",
    scopes: ["personal"],
  });
  assert.ok(retrieved.results.length >= 1);

  const facts = await pkRepo.listByActor("telegram:1");
  const reasoning = createReasoningEngine({ repository: rsRepo });
  const derived = await reasoning.deriveInsights({
    actorKey: "telegram:1",
    facts: [
      ...facts,
      {
        ...facts[0],
        id: "extra",
        content: "I practice TypeScript weekly",
        normalizedContent: "i practice typescript weekly",
      },
    ],
    requestKey: "reasoning-1",
  });
  assert.equal(derived.ok, true);
});

await test("Answer Engine compatibility with injected PK retrieve", async () => {
  const mem = createInMemoryPersonalKnowledgeRepository();
  await mem.upsert(
    createPersonalFact({
      actorKey: "telegram:1",
      domain: "Preferences",
      content: "I prefer quiet mornings",
      normalizedContent: "i prefer quiet mornings",
      confidence: 0.95,
      requestKey: "a1",
    })
  );
  await mem.upsert(
    createPersonalFact({
      actorKey: "telegram:1",
      domain: "Preferences",
      content: "Quiet mornings help deep work",
      normalizedContent: "quiet mornings help deep work",
      confidence: 0.9,
      requestKey: "a2",
    })
  );

  const engine = createIsolatedAnswerEngine({
    retrievePersonal: async ({ actorKey }) => {
      const results = await Promise.resolve(
        mem.listByActor(actorKey, { limit: 10 })
      );
      return {
        ok: true,
        results: results.map((f) => ({
          ...f,
          scope: "personal",
          provenance: {
            sourceType: "personal_knowledge",
            provider: "test",
            retrievedAt: Date.now(),
          },
        })),
      };
    },
  });

  const result = await engine.answer({
    actorKey: "telegram:1",
    query: "quiet mornings",
    planOverrides: {
      includeWorld: false,
      includeDomains: false,
      includeReasoning: false,
    },
  });
  assert.equal(result.execution.type, "none");
  assert.equal(result.usedPersonalKnowledge, true);
});

await test("migration 0004 present — tables, indexes, RLS, not applied note", async () => {
  const sql = readFileSync(
    join(root, "supabase/migrations/0004_create_personal_knowledge_and_reasoning.sql"),
    "utf8"
  );
  assert.match(sql, /NOT executed against Supabase/i);
  assert.match(sql, /create table if not exists public\.personal_knowledge/i);
  assert.match(sql, /create table if not exists public\.reasoning_insights/i);
  assert.match(sql, /create table if not exists public\.reasoning_recommendations/i);
  assert.match(sql, /idempotency_key/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /almas_current_actor_key/i);
  assert.match(sql, /personal_knowledge_select_own/);
  assert.match(sql, /using gin/i);
  assert.ok(!sql.includes("FOR ALL"));
});

await test("engines and repositories have no Telegram / execution imports", async () => {
  const dirs = [
    join(root, "repositories"),
    join(root, "providers/storage/supabasePersonalKnowledgeRepository.js"),
    join(root, "providers/storage/supabaseReasoningRepository.js"),
  ];
  const files = [];
  for (const d of dirs) {
    try {
      const st = readFileSync(d, "utf8");
      files.push([d, st]);
    } catch {
      for (const f of readdirSync(d)) {
        if (f.endsWith(".js")) {
          files.push([join(d, f), readFileSync(join(d, f), "utf8")]);
        }
      }
    }
  }
  const forbidden = [
    "node-telegram-bot-api",
    "messageHandler",
    "actionExecutor",
    "addExpense",
    "saveMemory",
    "createTask",
  ];
  for (const [path, text] of files) {
    for (const bad of forbidden) {
      assert.ok(!text.includes(bad), `${path} must not contain ${bad}`);
    }
  }
  // Engines must not import supabase drivers
  const pkEngine = readFileSync(
    join(root, "services/personalKnowledge/personalKnowledgeEngine.js"),
    "utf8"
  );
  const rsEngine = readFileSync(
    join(root, "services/reasoning/reasoningEngine.js"),
    "utf8"
  );
  const answer = readFileSync(
    join(root, "services/answer/answerEngine.js"),
    "utf8"
  );
  assert.ok(!pkEngine.includes("supabasePersonalKnowledge"));
  assert.ok(!rsEngine.includes("supabaseReasoning"));
  assert.ok(!answer.includes("supabase"));
});

console.log(`\ndurable-repositories: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
