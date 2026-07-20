import assert from "node:assert/strict";
import { classifyInformationKinds } from "../services/inbox/informationKindClassifier.js";

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

function kinds(text, routingDecision = null, sourceType = null) {
  return classifyInformationKinds({
    normalizedText: text,
    routingDecision,
    sourceType,
  }).informationKinds;
}

function run() {
  test("maps finance / task / memory / knowledge / chat / search / command actions", () => {
    assert.deepEqual(
      kinds("x", { actions: [{ type: "finance_expense" }] }),
      ["finance"]
    );
    assert.deepEqual(kinds("x", { actions: [{ type: "task_create" }] }), ["task"]);
    assert.deepEqual(kinds("x", { actions: [{ type: "memory_save" }] }), ["memory"]);
    assert.deepEqual(kinds("x", { actions: [{ type: "knowledge_query" }] }), ["knowledge"]);
    assert.deepEqual(kinds("x", { actions: [{ type: "chat" }] }), ["chat"]);
    assert.deepEqual(kinds("x", { actions: [{ type: "search" }] }), ["search"]);
    assert.deepEqual(kinds("x", { actions: [{ type: "system_command" }] }), ["command"]);
  });

  test("finance + task preserves order and dedupes", () => {
    assert.deepEqual(
      kinds("Потратил 40000 на кофе и завтра купить батарейки", {
        actions: [
          { type: "finance_expense" },
          { type: "task_create" },
          { type: "finance_expense" },
        ],
      }),
      ["finance", "task"]
    );
  });

  test("idea / health / project deterministic hints", () => {
    assert.deepEqual(
      kinds("Идея: сделать семейный финансовый кабинет"),
      ["idea"]
    );
    assert.deepEqual(
      kinds("Сегодня вес 82.4 кг и прошёл 12000 шагов"),
      ["health"]
    );
    assert.deepEqual(
      kinds("Проект ALMAS: сегодня подключили голос"),
      ["project"]
    );
  });

  test("ordinary sentences do not become health or project", () => {
    assert.deepEqual(kinds("сегодня был хороший день"), ["unknown"]);
    assert.deepEqual(kinds("мы обсудили project management"), ["unknown"]);
  });

  test("source YouTube adds knowledge", () => {
    assert.ok(kinds("video", null, "youtube").includes("knowledge"));
  });

  test("memory note from routing", () => {
    assert.deepEqual(
      kinds("Запомни, что мне нравится работать ночью", {
        actions: [{ type: "memory_save" }],
      }),
      ["memory"]
    );
  });

  test("knowledge/chat from routing decision", () => {
    assert.deepEqual(
      kinds("Что автор говорил про монетизацию?", {
        actions: [{ type: "knowledge_query" }],
      }),
      ["knowledge"]
    );
  });

  test("menu / meaningless short input → unknown", () => {
    assert.deepEqual(kinds("4"), ["unknown"]);
    assert.deepEqual(kinds("📋 Задачи"), ["unknown"]);
  });

  test("unknown input → unknown", () => {
    assert.deepEqual(kinds("asdf qwer"), ["unknown"]);
  });

  if (process.exitCode) console.error("\nSome information-kind-classifier tests failed.");
  else console.log("\nAll information-kind-classifier tests passed.");
}

run();
