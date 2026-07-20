import assert from "node:assert/strict";
import { RELATIONSHIP_TYPES, createRelationship } from "../services/relationships/relationshipContracts.js";
import {
  validateRelationships,
  filterRelationshipsToExistingEntities,
} from "../services/relationships/relationshipValidator.js";
import {
  extractRelationshipsForItem,
  enrichExtractedItemsWithRelationships,
} from "../services/relationships/relationshipExtractor.js";
import { createExtractedItem } from "../services/inbox/universalExtractionContracts.js";
import { extractUniversalInformation } from "../services/inbox/universalExtractor.js";

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

function hasRel(item, type, targetKind) {
  return (item.relationships || []).some(
    (r) => r.type === type && r.targetKind === targetKind
  );
}

async function run() {
  await test("Finance → Project (cross-item)", () => {
    const items = enrichExtractedItemsWithRelationships(
      [
        createExtractedItem({
          index: 0,
          kind: "finance",
          content: "реклама",
          entities: { direction: "expense", amount: 500, currency: "USD", companies: ["Kaspi"] },
        }),
        createExtractedItem({
          index: 1,
          kind: "project",
          content: "ALMAS",
          entities: { projectName: "ALMAS" },
        }),
      ],
      "Потратил 500 на рекламу по проекту ALMAS"
    );
    assert.ok(hasRel(items[0], "related_to", "project") || hasRel(items[0], "belongs_to", "project"));
    assert.ok(hasRel(items[0], "paid_to", "companies"));
  });

  await test("Task → Project (cross-item)", () => {
    const items = enrichExtractedItemsWithRelationships(
      [
        createExtractedItem({
          index: 0,
          kind: "task",
          content: "подключить голос",
          entities: { title: "подключить голос" },
        }),
        createExtractedItem({
          index: 1,
          kind: "project",
          content: "ALMAS",
          entities: { projectName: "ALMAS" },
        }),
      ],
      "По проекту ALMAS завтра подключить голос"
    );
    assert.ok(hasRel(items[0], "belongs_to", "project"));
  });

  await test("Meeting → Person (participant)", () => {
    const item = createExtractedItem({
      kind: "event",
      content: "встреча",
      entities: { people: ["Иваном"] },
    });
    const rels = extractRelationshipsForItem(item, "Встреча с Иваном завтра");
    assert.ok(rels.some((r) => r.type === "participant" && r.targetKind === "people"));
    assert.equal(rels[0].metadata.targetValue, "Иваном");
  });

  await test("Idea → Knowledge (cross-item inspired_by)", () => {
    const items = enrichExtractedItemsWithRelationships(
      [
        createExtractedItem({
          index: 0,
          kind: "idea",
          content: "новая механика",
          entities: { summary: "новая механика" },
        }),
        createExtractedItem({
          index: 1,
          kind: "knowledge",
          content: "YouTube notes",
          entities: {},
        }),
      ],
      "Идея из видео: новая механика"
    );
    assert.ok(hasRel(items[0], "inspired_by", "knowledge"));
  });

  await test("Expense → Person (paid_to)", () => {
    const item = createExtractedItem({
      kind: "finance",
      content: "обед",
      entities: {
        direction: "expense",
        amount: 20,
        currency: "USD",
        people: ["Alice"],
      },
    });
    const rels = extractRelationshipsForItem(item, "Paid Alice 20 USD for lunch");
    assert.ok(rels.some((r) => r.type === "paid_to" && r.targetKind === "people"));
  });

  await test("Multiple relations on one task", () => {
    const item = createExtractedItem({
      kind: "task",
      content: "купить батарейки",
      entities: {
        title: "купить батарейки",
        companies: ["Kaspi"],
        brands: ["Xbox"],
        people: ["Alice"],
      },
    });
    const rels = extractRelationshipsForItem(
      item,
      "Купить батарейки для Xbox в Kaspi с Alice"
    );
    assert.ok(rels.some((r) => r.type === "related_to" && r.targetKind === "companies"));
    assert.ok(rels.some((r) => r.type === "related_to" && r.targetKind === "brands"));
    assert.ok(rels.some((r) => r.type === "assigned_to" && r.targetKind === "people"));
    assert.ok(rels.length >= 3);
  });

  await test("Unknown entities — no invented relationships", () => {
    const item = createExtractedItem({
      kind: "task",
      content: "просто задача",
      entities: { title: "просто задача" },
    });
    const rels = extractRelationshipsForItem(item, "просто задача без деталей");
    assert.equal(rels.length, 0);
  });

  await test("No hallucinations — filter drops missing entity targets", () => {
    const item = createExtractedItem({
      kind: "finance",
      content: "кофе",
      entities: { direction: "expense", amount: 10, currency: "USD" },
    });
    const filtered = filterRelationshipsToExistingEntities(
      [
        createRelationship({
          type: "paid_to",
          sourceKind: "finance",
          targetKind: "companies",
          confidence: 0.9,
          metadata: { targetValue: "Kaspi" },
        }),
      ],
      item,
      [item]
    );
    assert.equal(filtered.length, 0);
  });

  await test("validator rejects unknown relationship types", () => {
    const list = validateRelationships([
      { type: "owns", sourceKind: "task", targetKind: "project", confidence: 1 },
      {
        type: "belongs_to",
        sourceKind: "task",
        targetKind: "project",
        confidence: 0.9,
        metadata: { targetItemIndex: 1 },
      },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].type, "belongs_to");
    assert.ok(RELATIONSHIP_TYPES.includes("paid_to"));
  });

  await test("pipeline includes relationships after entities", async () => {
    const out = await extractUniversalInformation(
      "Купить батарейки для Xbox в Kaspi завтра за 12000",
      { provider: null }
    );
    assert.ok(out.items.length >= 1);
    const item = out.items[0];
    assert.ok(Array.isArray(item.relationships));
    // Grounded brand/company should yield related_to when task-like
    if (item.kind === "task") {
      assert.ok(
        item.relationships.some(
          (r) =>
            (r.targetKind === "brands" || r.targetKind === "companies") &&
            (r.type === "related_to" || r.type === "paid_to")
        )
      );
    }
  });

  if (process.exitCode) console.error("\nSome relationship-extraction tests failed.");
  else console.log("\nAll relationship-extraction tests passed.");
}

run();
