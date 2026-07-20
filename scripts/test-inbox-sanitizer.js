import assert from "node:assert/strict";
import {
  sanitizeInboxMetadata,
  sanitizeRoutingDecision,
  sanitizeExecutionSummary,
  sanitizeInboxError,
} from "../services/inbox/inboxSanitizer.js";

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function run() {
  test("embedding / vectors / authorization / API keys / stack / prompts removed", () => {
    const source = {
      authorization: "Bearer SECRET",
      api_key: "sk-test",
      embedding: Array.from({ length: 1536 }, (_, i) => i / 1536),
      vector: Array.from({ length: 100 }, () => 0.1),
      prompt: "SYSTEM: do bad things",
      system_message: "hidden",
      reasoning: "private chain of thought",
      stack: "Error\n  at foo",
      stacktrace: "boom",
      cookie: "session=1",
      good: { actionType: "task_create", confidence: 0.9, reasonCode: "ok" },
    };
    const snapshot = JSON.stringify(source);
    const out = sanitizeInboxMetadata(source);
    assert.equal(JSON.stringify(source), snapshot, "must not mutate source");
    assert.equal(out.authorization, "[redacted]");
    assert.equal(out.api_key, "[redacted]");
    assert.equal(out.embedding, "[redacted]");
    assert.equal(out.vector, "[redacted]");
    assert.equal(out.prompt, "[redacted]");
    assert.equal(out.system_message, "[redacted]");
    assert.equal(out.reasoning, "[redacted]");
    assert.equal(out.stack, "[redacted]");
    assert.equal(out.good.actionType, "task_create");
    assert.equal(out.good.confidence, 0.9);
    assert.equal(out.good.reasonCode, "ok");
  });

  test("full rows with embeddings are reduced", () => {
    const row = {
      id: "abc",
      type: "message",
      created_at: "2026-01-01",
      embedding: Array.from({ length: 64 }, () => 1),
      content: "secret note",
    };
    const out = sanitizeInboxMetadata(row);
    assert.equal(out._omitted, "row_with_embedding");
    assert.equal(out.id, "abc");
    assert.equal(out.embedding, undefined);
  });

  test("strings / arrays / depth capped", () => {
    const out = sanitizeInboxMetadata(
      {
        long: "x".repeat(1000),
        arr: Array.from({ length: 100 }, (_, i) => i),
        deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
      },
      { maxStringLength: 20, maxArrayLength: 5, maxDepth: 3 }
    );
    assert.ok(String(out.long).endsWith("…"));
    assert.ok(out.arr.length <= 6);
    assert.equal(out.deep.a.b.c, "[max_depth]");
  });

  test("sanitizeRoutingDecision preserves action type / confidence / reason", () => {
    const out = sanitizeRoutingDecision({
      mode: "shadow",
      tier: "cheap",
      reasonCode: "clear_task",
      actions: [{ type: "task_create", confidence: 0.95, requiresConfirmation: false }],
      skippedReasons: "skipped_shadow_mode:1",
    });
    assert.equal(out.actions[0].type, "task_create");
    assert.equal(out.actions[0].confidence, 0.95);
    assert.equal(out.reasonCode, "clear_task");
    assert.equal(out.skippedReasons, "skipped_shadow_mode:1");
  });

  test("sanitizeExecutionSummary preserves executed / skip reason", () => {
    const out = sanitizeExecutionSummary({
      results: [
        { action: { type: "task_create" }, executed: true, reason: "task_created" },
        { action: { type: "finance_expense" }, executed: false, reason: "skipped_finance_not_enabled" },
      ],
      executedCount: 1,
      skippedCount: 1,
    });
    assert.equal(out.results[0].executed, true);
    assert.equal(out.results[1].reason, "skipped_finance_not_enabled");
  });

  test("sanitizeInboxError drops stack traces", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at secret.js:1";
    const out = sanitizeInboxError(err);
    assert.equal(out.message, "boom");
    assert.equal(out.stack, undefined);
  });

  if (process.exitCode) console.error("\nSome inbox-sanitizer tests failed.");
  else console.log("\nAll inbox-sanitizer tests passed.");
}

run();
