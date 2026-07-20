import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExtractedItem,
  EXTRACTION_KINDS,
} from "../services/inbox/universalExtractionContracts.js";
import { validateExtractedItems } from "../services/inbox/universalExtractionValidator.js";
import { sanitizeUniversalExtraction } from "../services/inbox/universalExtractionSanitizer.js";
import {
  extractUniversalInformation,
  extractFinanceDeterministic,
  extractTaskDeterministic,
  extractIdeaDeterministic,
  extractHealthDeterministic,
  extractProjectDeterministic,
} from "../services/inbox/universalExtractor.js";
import { recordInboxUniversalExtraction } from "../services/inbox/inboxService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((error) => {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function providerFromItems(items, extras = {}) {
  return {
    name: "fake-extraction",
    async run() {
      return {
        ok: true,
        result: {
          language: extras.language || "ru",
          reasonCode: extras.reasonCode || "test",
          needsClarification: Boolean(extras.needsClarification),
          items,
        },
        usage: { model: "test", latencyMs: 1 },
      };
    },
  };
}

async function run() {
  await test("finance only (deterministic)", async () => {
    const item = extractFinanceDeterministic("Потратил 500 долларов на рекламу");
    assert.ok(item);
    assert.equal(item.kind, "finance");
    assert.equal(item.entities.direction, "expense");
    assert.equal(item.entities.amount, 500);
    assert.equal(item.entities.currency, "USD");

    const out = await extractUniversalInformation("Потратил 500 долларов на рекламу", {
      provider: null,
    });
    assert.equal(out.items[0].kind, "finance");
    assert.equal(out.tier, "deterministic");
  });

  await test("task only (deterministic)", () => {
    const item = extractTaskDeterministic("завтра нужно позвонить поставщику");
    assert.ok(item);
    assert.equal(item.kind, "task");
    assert.match(item.content, /позвонить поставщику/i);
    assert.equal(item.entities.dueDateText, "завтра");
    assert.equal(item.temporal.raw, "завтра");
  });

  await test("idea only (deterministic)", () => {
    const item = extractIdeaDeterministic("Идея: новая механика для Telegram-бота");
    assert.ok(item);
    assert.equal(item.kind, "idea");
    assert.match(item.content, /механика/i);
  });

  await test("health only (deterministic)", () => {
    const items = extractHealthDeterministic("Сегодня вес 82.4 кг и прошёл 12000 шагов");
    assert.ok(items.some((i) => i.entities.metric === "weight"));
    assert.ok(items.some((i) => i.entities.metric === "steps"));
  });

  await test("project only (deterministic)", () => {
    const item = extractProjectDeterministic("Проект ALMAS: сегодня подключили голос");
    assert.ok(item);
    assert.equal(item.kind, "project");
    assert.equal(item.entities.projectName, "ALMAS");
  });

  await test("finance + task via injected AI", async () => {
    const out = await extractUniversalInformation(
      "Потратил 40000 на кофе и завтра купить батарейки",
      {
        provider: providerFromItems([
          {
            kind: "finance",
            content: "кофе",
            confidence: 0.95,
            entities: { direction: "expense", amount: 40000, currency: "VND", description: "кофе" },
            temporalRaw: null,
            requiresClarification: false,
            clarificationReason: null,
          },
          {
            kind: "task",
            content: "купить батарейки",
            confidence: 0.9,
            entities: { title: "купить батарейки", dueDateText: "завтра" },
            temporalRaw: "завтра",
            requiresClarification: false,
            clarificationReason: null,
          },
        ]),
      }
    );
    assert.deepEqual(
      out.items.map((i) => i.kind),
      ["finance", "task"]
    );
  });

  await test("finance + idea + task (canonical example)", async () => {
    const text =
      "Сегодня заплатил 500 долларов за рекламу, придумал новую механику для Telegram-бота и завтра нужно позвонить поставщику.";
    const out = await extractUniversalInformation(text, {
      provider: providerFromItems([
        {
          kind: "finance",
          content: "реклама",
          confidence: 0.95,
          entities: {
            direction: "expense",
            amount: 500,
            currency: "USD",
            description: "реклама",
            dateText: "сегодня",
          },
          temporalRaw: "сегодня",
          requiresClarification: false,
          clarificationReason: null,
        },
        {
          kind: "idea",
          content: "новая механика для Telegram-бота",
          confidence: 0.9,
          entities: { summary: "новая механика для Telegram-бота" },
          temporalRaw: null,
          requiresClarification: false,
          clarificationReason: null,
        },
        {
          kind: "task",
          content: "позвонить поставщику",
          confidence: 0.9,
          entities: { title: "позвонить поставщику", dueDateText: "завтра" },
          temporalRaw: "завтра",
          requiresClarification: false,
          clarificationReason: null,
        },
      ]),
    });

    assert.equal(out.items.length, 3);
    assert.equal(out.items[0].kind, "finance");
    assert.equal(out.items[0].entities.amount, 500);
    assert.equal(out.items[0].entities.currency, "USD");
    assert.equal(out.items[1].kind, "idea");
    assert.equal(out.items[2].kind, "task");
    assert.equal(out.items[2].temporal.raw, "завтра");
  });

  await test("mixed Russian/English", async () => {
    const out = await extractUniversalInformation(
      "Spent 20 dollars on lunch and idea: family finance cabinet",
      {
        provider: providerFromItems([
          {
            kind: "finance",
            content: "lunch",
            confidence: 0.9,
            entities: { direction: "expense", amount: 20, currency: "USD", description: "lunch" },
            temporalRaw: null,
            requiresClarification: false,
            clarificationReason: null,
          },
          {
            kind: "idea",
            content: "family finance cabinet",
            confidence: 0.9,
            entities: { summary: "family finance cabinet" },
            temporalRaw: null,
            requiresClarification: false,
            clarificationReason: null,
          },
        ], { language: "en" }),
      }
    );
    assert.deepEqual(
      out.items.map((i) => i.kind),
      ["finance", "idea"]
    );
  });

  await test("Kazakh example", async () => {
    const out = await extractUniversalInformation("Бүгін кофеге 5000 теңге жұмсадым", {
      forceAi: true,
      provider: providerFromItems([
        {
          kind: "finance",
          content: "кофе",
          confidence: 0.9,
          entities: { direction: "expense", amount: 5000, currency: "KZT", description: "кофе" },
          temporalRaw: "Бүгін",
          requiresClarification: false,
          clarificationReason: null,
        },
      ], { language: "kk" }),
    });
    assert.equal(out.items[0].kind, "finance");
    assert.equal(out.items[0].entities.currency, "KZT");
    assert.equal(out.items[0].entities.amount, 5000);
  });

  await test("missing finance amount → clarification", () => {
    const validated = validateExtractedItems([
      {
        kind: "finance",
        content: "кофе",
        confidence: 0.4,
        entities: { direction: "expense", description: "кофе" },
      },
    ]);
    assert.equal(validated.items[0].requiresClarification, true);
    assert.equal(validated.items[0].clarificationReason, "missing_finance_amount");
    assert.equal(validated.items[0].entities.amount, undefined);
  });

  await test("missing task content → clarification", () => {
    const validated = validateExtractedItems([
      { kind: "task", content: "", confidence: 0.5, entities: {} },
    ]);
    assert.equal(validated.items[0].requiresClarification, true);
    assert.equal(validated.items[0].clarificationReason, "missing_task_content");
  });

  await test("duplicate items removed; order preserved", () => {
    const validated = validateExtractedItems([
      createExtractedItem({ kind: "finance", content: "кофе", entities: { amount: 1, currency: "USD", direction: "expense" } }),
      createExtractedItem({ kind: "task", content: "купить", entities: { title: "купить" } }),
      createExtractedItem({ kind: "finance", content: "кофе", entities: { amount: 1, currency: "USD", direction: "expense" } }),
      createExtractedItem({ kind: "idea", content: "x", entities: { summary: "x" } }),
    ]);
    assert.deepEqual(
      validated.items.map((i) => i.kind),
      ["finance", "task", "idea"]
    );
    assert.deepEqual(
      validated.items.map((i) => i.index),
      [0, 1, 2]
    );
  });

  await test("max-items cap", () => {
    const raw = Array.from({ length: 8 }, (_, i) =>
      createExtractedItem({
        kind: "task",
        content: `task-${i}`,
        entities: { title: `task-${i}` },
        confidence: 0.9,
      })
    );
    const validated = validateExtractedItems(raw, { maxItems: 5 });
    assert.equal(validated.items.length, 5);
    assert.equal(validated.truncated, true);
  });

  await test("malformed AI output / unknown kinds rejected", async () => {
    const out = await extractUniversalInformation("hello", {
      provider: {
        async run() {
          return {
            ok: true,
            result: {
              language: "en",
              reasonCode: "x",
              needsClarification: false,
              items: [
                { kind: "not_a_kind", content: "x", confidence: 1, entities: {}, temporalRaw: null, requiresClarification: false, clarificationReason: null },
                null,
                { kind: "chat", content: "hi", confidence: 0.8, entities: {}, temporalRaw: null, requiresClarification: false, clarificationReason: null },
              ],
            },
          };
        },
      },
    });
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].kind, "chat");
  });

  await test("provider failure does not throw; safe result", async () => {
    const out = await extractUniversalInformation("ambiguous multipart и завтра нужно x", {
      provider: {
        async run() {
          throw new Error("boom");
        },
      },
    });
    assert.ok(out);
    assert.ok(Array.isArray(out.items));
    assert.match(String(out.reasonCode), /extraction_failed|multipart|fallback|ok|deterministic/);
  });

  await test("sanitizer strips prompts/embeddings; keeps kinds", () => {
    const sanitized = sanitizeUniversalExtraction({
      tier: "cheap",
      reasonCode: "ok",
      language: "ru",
      needsClarification: false,
      items: [
        {
          kind: "finance",
          content: "реклама",
          confidence: 0.9,
          entities: {
            amount: 500,
            currency: "USD",
            direction: "expense",
            embedding: Array.from({ length: 64 }, () => 0.1),
            prompt: "SECRET PROMPT",
          },
          temporal: { raw: "сегодня" },
          requiresClarification: false,
          clarificationReason: null,
        },
      ],
      prompt: "full system prompt",
      rawProvider: { data: 1 },
    });
    assert.equal(sanitized.items[0].kind, "finance");
    assert.equal(sanitized.items[0].entities.amount, 500);
    assert.equal(sanitized.items[0].entities.embedding, "[redacted]");
    assert.equal(sanitized.items[0].entities.prompt, "[redacted]");
    assert.equal(sanitized.prompt, undefined);
  });

  await test("extraction stored in sanitized Inbox data (DI)", async () => {
    const patches = [];
    const result = await recordInboxUniversalExtraction(
      "rk-extract",
      {
        tier: "cheap",
        reasonCode: "ok",
        language: "ru",
        items: [
          createExtractedItem({
            kind: "idea",
            content: "механика",
            confidence: 0.9,
            entities: { summary: "механика" },
          }),
        ],
      },
      {
        forceEnabled: true,
        findInboxItemByRequestKeyFn: async () => ({
          requestKey: "rk-extract",
          metadata: { classificationReasons: ["x"] },
          routingDecision: { mode: "shadow", actions: [] },
        }),
        updateInboxItemByRequestKeyFn: async (requestKey, patch) => {
          patches.push(patch);
          return { requestKey, ...patch };
        },
      }
    );
    assert.equal(result.success, true);
    assert.ok(patches[0].metadata.universalExtraction);
    assert.ok(patches[0].routingDecision.universalExtraction);
    assert.equal(patches[0].metadata.universalExtraction.items[0].kind, "idea");
    assert.equal(patches[0].metadata.classificationReasons[0], "x");
  });

  await test("no execution / Telegram imports in extraction modules", () => {
    for (const rel of [
      "services/inbox/universalExtractionContracts.js",
      "services/inbox/universalExtractionValidator.js",
      "services/inbox/universalExtractionSanitizer.js",
      "services/inbox/universalExtractor.js",
    ]) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      assert.doesNotMatch(source, /actionExecutor\.js/);
      assert.doesNotMatch(source, /financeService\.js/);
      assert.doesNotMatch(source, /memoryService\.js/);
      assert.doesNotMatch(source, /taskService\.js/);
      assert.doesNotMatch(source, /knowledgeService\.js/);
      assert.doesNotMatch(source, /config\/bot\.js/);
      assert.doesNotMatch(source, /node-telegram-bot-api/);
    }
  });

  await test("messageHandler Telegram reply paths unchanged for extraction (no new sendMessage for extract)", () => {
    const source = fs.readFileSync(path.join(root, "handlers/messageHandler.js"), "utf8");
    assert.doesNotMatch(source, /extractUniversalInformation/);
    assert.doesNotMatch(source, /universalExtractor/);
    assert.match(source, /startInboxReceivedObservation/);
  });

  await test("EXTRACTION_KINDS includes required kinds", () => {
    for (const kind of [
      "finance",
      "task",
      "idea",
      "health",
      "project",
      "memory",
      "unknown",
    ]) {
      assert.ok(EXTRACTION_KINDS.includes(kind), kind);
    }
  });

  if (process.exitCode) console.error("\nSome universal-extraction tests failed.");
  else console.log("\nAll universal-extraction tests passed.");
}

run();
