import assert from "node:assert/strict";
import {
  SOURCE_TYPES,
  INBOX_STATUSES,
  INFORMATION_KINDS,
  buildActorFromTelegram,
  createInboxItem,
  normalizeInboxItem,
  validateSourceType,
  validateInboxStatus,
  validateInformationKinds,
  summarizeRoutingDecision,
  summarizeExecutionResult,
} from "../services/inbox/inboxContracts.js";

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
  test("enums are frozen closed sets", () => {
    assert.ok(Object.isFrozen(SOURCE_TYPES));
    assert.ok(Object.isFrozen(INBOX_STATUSES));
    assert.ok(Object.isFrozen(INFORMATION_KINDS));
    assert.ok(SOURCE_TYPES.includes("telegram_text"));
    assert.ok(INBOX_STATUSES.includes("received"));
    assert.ok(INFORMATION_KINDS.includes("idea"));
  });

  test("Telegram actorKey uses telegramUserId, never username or chatId", () => {
    const actor = buildActorFromTelegram(
      { id: 42, username: "almas", first_name: "Almas", last_name: "K" },
      999
    );
    assert.equal(actor.actorKey, "telegram:42");
    assert.equal(actor.telegramUserId, 42);
    assert.equal(actor.chatId, 999);
    assert.equal(actor.username, "almas");
    assert.notEqual(actor.actorKey, "telegram:almas");
    assert.notEqual(actor.actorKey, "telegram:999");
  });

  test("different Telegram IDs produce different actorKeys even with identical usernames", () => {
    const a = buildActorFromTelegram({ id: 1, username: "same" }, 10);
    const b = buildActorFromTelegram({ id: 2, username: "same" }, 10);
    assert.equal(a.username, b.username);
    assert.notEqual(a.actorKey, b.actorKey);
  });

  test("missing username is accepted", () => {
    const actor = buildActorFromTelegram({ id: 7, first_name: " ann" }, 1);
    assert.equal(actor.actorKey, "telegram:7");
    assert.equal(actor.username, null);
  });

  test("originalText and normalizedText remain separate", () => {
    const item = createInboxItem({
      requestKey: "msg:1:1",
      sourceType: "telegram_text",
      actor: buildActorFromTelegram({ id: 1 }),
      originalText: "  Привет!!!  ",
      normalizedText: "Привет!",
    });
    assert.equal(item.originalText, "  Привет!!!  ");
    assert.equal(item.normalizedText, "Привет!");
  });

  test("invalid source type / status handled safely", () => {
    assert.equal(validateSourceType("nope"), null);
    assert.equal(validateInboxStatus("nope"), null);
    const item = createInboxItem({
      requestKey: "k",
      sourceType: "bogus",
      status: "bogus",
      actor: buildActorFromTelegram({ id: 1 }),
      originalText: "x",
    });
    assert.equal(item.sourceType, "unknown");
    assert.equal(item.status, "received");
  });

  test("kinds validated; duplicates removed preserving order; invalid → unknown", () => {
    assert.deepEqual(
      validateInformationKinds(["finance", "task", "finance", "nope", "idea"]),
      ["finance", "task", "unknown", "idea"]
    );
  });

  test("createInboxItem / normalizeInboxItem do not mutate caller input", () => {
    const input = {
      requestKey: "k",
      sourceType: "telegram_text",
      actor: buildActorFromTelegram({ id: 1 }),
      originalText: "hi",
      informationKinds: ["finance"],
      metadata: { a: 1 },
    };
    const snapshot = JSON.stringify(input);
    createInboxItem(input);
    normalizeInboxItem(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  test("summarizeRoutingDecision / summarizeExecutionResult keep audit fields only", () => {
    const summary = summarizeRoutingDecision({
      mode: "shadow",
      tier: "cheap",
      language: "ru",
      reasonCode: "clear_task",
      actions: [{ type: "task_create", confidence: 0.9, payload: { content: "x" } }],
      executedCount: 0,
      skippedCount: 1,
      timings: { totalMs: 12 },
    });
    assert.equal(summary.actions[0].type, "task_create");
    assert.equal(summary.actions[0].confidence, 0.9);
    assert.equal(summary.latencyMs, 12);
    assert.equal(summary.actions[0].payload, undefined);

    const exec = summarizeExecutionResult({
      results: [{ action: { type: "task_create" }, executed: true, reason: "task_created" }],
      executedCount: 1,
      skippedCount: 0,
    });
    assert.equal(exec.results[0].type, "task_create");
    assert.equal(exec.results[0].executed, true);
  });

  if (process.exitCode) console.error("\nSome inbox-contracts tests failed.");
  else console.log("\nAll inbox-contracts tests passed.");
}

run();
