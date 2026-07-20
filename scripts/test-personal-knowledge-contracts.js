import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PERSONAL_KNOWLEDGE_DOMAINS,
  WRITABLE_PERSONAL_DOMAINS,
  PERSONAL_SCOPE,
  createPersonalFact,
  buildIdempotencyKey,
  stableContentHash,
  mapRegistryKindToPersonalDomain,
  isWritablePersonalDomain,
  normalizePersonalContent,
} from "../services/personalKnowledge/personalKnowledgeContracts.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`✅ ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

async function run() {
  await test("closed domain list includes required ontology", () => {
    for (const d of [
      "Identity",
      "Preferences",
      "Goals",
      "Projects",
      "Ideas",
      "Health",
      "Contacts",
      "Decisions",
      "Habits",
      "Knowledge",
      "Finance",
      "Tasks",
      "Timeline",
    ]) {
      assert.ok(PERSONAL_KNOWLEDGE_DOMAINS.includes(d));
    }
    assert.equal(isWritablePersonalDomain("Timeline"), false);
    assert.ok(WRITABLE_PERSONAL_DOMAINS.every((d) => d !== "Timeline"));
  });

  await test("createPersonalFact has required contract fields", () => {
    const fact = createPersonalFact({
      actorKey: "telegram:1",
      domain: "Preferences",
      content: "Мне нравится работать ночью",
      confidence: 0.9,
      evidence: { quote: "Мне нравится работать ночью", candidateKind: null },
      sourceType: "user_text",
      entities: [{ type: "preference", value: "night work" }],
      requestKey: "rk-1",
    });
    for (const key of [
      "id",
      "actorKey",
      "domain",
      "content",
      "normalizedContent",
      "confidence",
      "evidence",
      "sourceType",
      "entities",
      "createdAt",
      "updatedAt",
      "status",
      "requestKey",
      "scope",
    ]) {
      assert.ok(key in fact, `missing ${key}`);
    }
    assert.equal(fact.scope, PERSONAL_SCOPE);
    assert.equal(fact.requestKey, "rk-1");
    assert.ok(fact.idempotencyKey.startsWith("req:"));
  });

  await test("stable hash fallback idempotency key", () => {
    const a = buildIdempotencyKey(
      "telegram:1",
      "Identity",
      normalizePersonalContent("Меня зовут Алмас")
    );
    const b = buildIdempotencyKey(
      "telegram:1",
      "Identity",
      normalizePersonalContent("Меня зовут Алмас")
    );
    assert.equal(a, b);
    assert.ok(a.startsWith("hash:"));
    assert.ok(stableContentHash("x").startsWith("pkh_"));
  });

  await test("registry kind mapping (not a competing registry)", () => {
    assert.equal(mapRegistryKindToPersonalDomain("goal"), "Goals");
    assert.equal(mapRegistryKindToPersonalDomain("idea"), "Ideas");
    assert.equal(mapRegistryKindToPersonalDomain("contact"), "Contacts");
    assert.equal(mapRegistryKindToPersonalDomain("event"), "Timeline");
    assert.equal(mapRegistryKindToPersonalDomain("nope"), null);
  });

  await test("personalKnowledge modules have no Telegram/Supabase/execution imports", () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../services/personalKnowledge"
    );
    const files = [
      "personalKnowledgeContracts.js",
      "personalKnowledgeClassifier.js",
      "personalKnowledgeValidator.js",
      "personalKnowledgeStore.js",
      "worldKnowledgeAdapter.js",
      "personalKnowledgeEngine.js",
      "index.js",
    ];
    const banned = [
      "config/bot",
      "providers/storage/supabase",
      "financeService",
      "actionExecutor",
      "memoryService",
      "messageHandler",
      "inboxObservation",
      "knowledgeService",
    ];
    for (const file of files) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const b of banned) {
        assert.equal(src.includes(b), false, `${file} imports ${b}`);
      }
    }
  });

  console.log(`\npersonal-knowledge-contracts: ${passed} passed, ${failed} failed`);
}

run();
