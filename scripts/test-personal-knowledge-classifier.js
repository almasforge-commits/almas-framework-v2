import assert from "node:assert/strict";

import {
  classifyPersonalKnowledge,
  looksLikeWorldOrGeneralKnowledge,
} from "../services/personalKnowledge/personalKnowledgeClassifier.js";
import { validatePersonalIngest } from "../services/personalKnowledge/personalKnowledgeValidator.js";
import { REJECT_REASONS } from "../services/personalKnowledge/personalKnowledgeContracts.js";

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
  await test("Identity classification RU/EN", () => {
    const ru = classifyPersonalKnowledge("Меня зовут Алмас");
    assert.equal(ru.domain, "Identity");
    assert.ok(ru.confidence >= 0.7);
    const en = classifyPersonalKnowledge("My name is Almas");
    assert.equal(en.domain, "Identity");
  });

  await test("Preferences classification", () => {
    const ru = classifyPersonalKnowledge("Мне нравится работать ночью");
    assert.equal(ru.domain, "Preferences");
    const en = classifyPersonalKnowledge("I prefer deep work in the morning");
    assert.equal(en.domain, "Preferences");
  });

  await test("Goal classification", () => {
    const ru = classifyPersonalKnowledge("Моя цель — запустить ALMAS");
    assert.equal(ru.domain, "Goals");
    const en = classifyPersonalKnowledge("My goal is to ship the product");
    assert.equal(en.domain, "Goals");
  });

  await test("Project/Idea/Health/Contact/Decision/Habit mapping", () => {
    assert.equal(
      classifyPersonalKnowledge("Работаю над проектом ALMAS").domain,
      "Projects"
    );
    assert.equal(
      classifyPersonalKnowledge("Идея: голосовой дневник").domain,
      "Ideas"
    );
    assert.equal(
      classifyPersonalKnowledge("Вес сегодня 72").domain,
      "Health"
    );
    assert.equal(
      classifyPersonalKnowledge("Contact: Arman, phone +7").domain,
      "Contacts"
    );
    assert.equal(
      classifyPersonalKnowledge("Я решил переехать в Бангкок").domain,
      "Decisions"
    );
    assert.equal(
      classifyPersonalKnowledge("Каждый день медитирую").domain,
      "Habits"
    );
  });

  await test("pre-labeled candidate raises confidence", () => {
    const base = classifyPersonalKnowledge("хочу достичь свободы");
    const withCand = classifyPersonalKnowledge("хочу достичь свободы", {
      candidate: { kind: "goal", confidence: 0.95 },
    });
    assert.equal(withCand.domain, "Goals");
    assert.ok(withCand.confidence >= base.confidence);
  });

  await test("world/general rejection signals", () => {
    assert.equal(looksLikeWorldOrGeneralKnowledge("Столица Франции"), true);
    const c = classifyPersonalKnowledge("What is the capital of France?");
    assert.equal(c.scope, "world");
    assert.equal(c.domain, null);
  });

  await test("validator rejects world, low confidence, timeline, destructive", () => {
    assert.equal(
      validatePersonalIngest({
        actorKey: "telegram:1",
        text: "Столица Франции Париж",
        domain: "Knowledge",
        confidence: 0.9,
        scope: "world",
        sourceType: "user_text",
      }).reason,
      REJECT_REASONS.WORLD_OR_GENERAL
    );

    assert.equal(
      validatePersonalIngest({
        actorKey: "telegram:1",
        text: "Мне нравится чай",
        domain: "Preferences",
        confidence: 0.2,
        sourceType: "user_text",
      }).reason,
      REJECT_REASONS.LOW_CONFIDENCE
    );

    assert.equal(
      validatePersonalIngest({
        actorKey: "telegram:1",
        text: "встреча завтра",
        domain: "Timeline",
        confidence: 0.9,
        sourceType: "user_text",
      }).reason,
      REJECT_REASONS.TIMELINE_WRITE
    );

    assert.equal(
      validatePersonalIngest({
        actorKey: "telegram:1",
        text: "удалить все знания",
        domain: "Knowledge",
        confidence: 0.9,
        sourceType: "user_text",
      }).reason,
      REJECT_REASONS.DESTRUCTIVE_COMMAND
    );
  });

  await test("validator rejects finance execution payloads", () => {
    const r = validatePersonalIngest({
      actorKey: "telegram:1",
      text: "потратил 500 на кофе",
      domain: "Finance",
      confidence: 0.9,
      sourceType: "user_text",
      executeFinance: true,
      payload: { amount: 500, type: "expense", currency: "VND" },
    });
    assert.equal(r.reason, REJECT_REASONS.FINANCE_EXECUTION_PAYLOAD);
  });

  await test("finance mention may classify without execution payload", () => {
    const c = classifyPersonalKnowledge("Потратил много на еду в этом месяце");
    assert.equal(c.domain, "Finance");
    const v = validatePersonalIngest({
      actorKey: "telegram:1",
      text: "Потратил много на еду в этом месяце",
      domain: c.domain,
      confidence: c.confidence,
      sourceType: "user_text",
    });
    assert.equal(v.ok, true);
  });

  console.log(`\npersonal-knowledge-classifier: ${passed} passed, ${failed} failed`);
}

run();
