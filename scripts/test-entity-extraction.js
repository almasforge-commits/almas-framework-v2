import assert from "node:assert/strict";
import { ENTITY_TYPES, createEmptyEntityBag, isEntityBagEmpty } from "../services/entities/entityContracts.js";
import { extractEntities, enrichExtractedItemWithEntities } from "../services/entities/entityExtractor.js";
import { validateEntityBag } from "../services/entities/entityValidator.js";
import { extractUniversalInformation } from "../services/inbox/universalExtractor.js";
import { createExtractedItem } from "../services/inbox/universalExtractionContracts.js";

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

async function run() {
  await test("people (explicit with/с pattern)", () => {
    const bag = extractEntities("Meeting with Alice tomorrow");
    assert.ok(bag.people.includes("Alice"));
    const bagRu = extractEntities("Встреча с Иваном завтра");
    assert.ok(bagRu.people.some((p) => /Иван/i.test(String(p))));
  });

  await test("companies", () => {
    const bag = extractEntities("Оплата в Kaspi за заказ");
    assert.ok(bag.companies.some((c) => /kaspi/i.test(String(c))));
  });

  await test("products", () => {
    const bag = extractEntities("Купить батарейки для Xbox");
    assert.ok(bag.products.some((p) => /батарейки/i.test(String(p))));
  });

  await test("mixed entities — Kaspi / Xbox / tomorrow / 12000", () => {
    const text = "Купить батарейки для Xbox в Kaspi завтра за 12000";
    const bag = extractEntities(text);
    assert.ok(bag.products.some((p) => /батарейки/i.test(String(p))));
    assert.ok(bag.brands.some((b) => /xbox/i.test(String(b))));
    assert.ok(bag.companies.some((c) => /kaspi/i.test(String(c))));
    assert.ok(bag.numbers.includes(12000));
    assert.ok(bag.dates.some((d) => /завтра/i.test(String(d))));
  });

  await test("English entities", () => {
    const bag = extractEntities("Buy batteries for Xbox at Amazon tomorrow for 20 USD");
    assert.ok(bag.brands.some((b) => /xbox/i.test(String(b))));
    assert.ok(bag.companies.some((c) => /amazon/i.test(String(c))));
    assert.ok(bag.currencies.includes("USD"));
    assert.ok(bag.dates.some((d) => /tomorrow/i.test(String(d))));
  });

  await test("Russian entities", () => {
    const bag = extractEntities("сегодня в Алматы купить батарейки за 5000 тенге");
    assert.ok(bag.cities.some((c) => /алматы/i.test(String(c))));
    assert.ok(bag.currencies.includes("KZT"));
    assert.ok(bag.dates.some((d) => /сегодня/i.test(String(d))));
  });

  await test("Kazakh date token", () => {
    const bag = extractEntities("Ертең Kaspi-де төлеу");
    assert.ok(bag.dates.some((d) => /ертең/i.test(String(d))));
    assert.ok(bag.companies.some((c) => /kaspi/i.test(String(c))));
  });

  await test("URLs", () => {
    const bag = extractEntities("See https://example.com/docs and www.test.kz");
    assert.ok(bag.urls.some((u) => String(u).includes("https://example.com")));
    assert.ok(bag.websites.some((u) => String(u).includes("www.test.kz")));
  });

  await test("Phones", () => {
    const bag = extractEntities("Call +7 701 123 45 67 later");
    assert.ok(bag.phones.length >= 1);
  });

  await test("Emails", () => {
    const bag = extractEntities("Write to user@example.com please");
    assert.deepEqual(bag.emails, ["user@example.com"]);
  });

  await test("Crypto tickers", () => {
    const bag = extractEntities("Bought BTC and ETH yesterday");
    assert.ok(bag.crypto.includes("BTC"));
    assert.ok(bag.crypto.includes("ETH"));
  });

  await test("Stock tickers", () => {
    const bag = extractEntities("Watching TSLA and AAPL");
    assert.ok(bag.stocks.includes("TSLA"));
    assert.ok(bag.stocks.includes("AAPL"));
  });

  await test("unknown entities stay empty — no hallucinations", () => {
    const bag = extractEntities("просто обычный день без деталей");
    assert.equal(bag.companies.length, 0);
    assert.equal(bag.brands.length, 0);
    assert.equal(bag.people.length, 0);
    assert.equal(bag.crypto.length, 0);
    assert.equal(bag.stocks.length, 0);
    assert.equal(bag.urls.length, 0);
    // Must not invent a fake company/product
    assert.ok(!JSON.stringify(bag).toLowerCase().includes("kaspi"));
    assert.ok(!JSON.stringify(bag).toLowerCase().includes("xbox"));
  });

  await test("validator drops unknown types and invents nothing", () => {
    const bag = validateEntityBag({
      companies: ["Kaspi", "Kaspi", ""],
      invented: ["nope"],
      numbers: [12000, "x"],
    });
    assert.deepEqual(bag.companies, ["Kaspi"]);
    assert.equal(bag.invented, undefined);
    assert.deepEqual(bag.numbers, [12000]);
    assert.equal(ENTITY_TYPES.length, Object.keys(createEmptyEntityBag()).length);
  });

  await test("enrichment merges into extraction item without dropping domain fields", () => {
    const item = createExtractedItem({
      kind: "task",
      content: "купить батарейки",
      entities: { title: "купить батарейки", dueDateText: "завтра" },
      temporal: { raw: "завтра" },
    });
    const enriched = enrichExtractedItemWithEntities(
      item,
      "Купить батарейки для Xbox в Kaspi завтра за 12000"
    );
    assert.equal(enriched.entities.title, "купить батарейки");
    assert.equal(enriched.entities.dueDateText, "завтра");
    assert.ok(enriched.entities.brands?.some((b) => /xbox/i.test(String(b))));
    assert.ok(enriched.entities.companies?.some((c) => /kaspi/i.test(String(c))));
    assert.ok(enriched.entities.numbers?.includes(12000));
  });

  await test("universal extraction pipeline includes entity bags", async () => {
    const out = await extractUniversalInformation(
      "Купить батарейки для Xbox в Kaspi завтра за 12000",
      { provider: null }
    );
    assert.ok(out.items.length >= 1);
    const item = out.items[0];
    assert.ok(item.entities);
    assert.ok(
      item.entities.brands?.some((b) => /xbox/i.test(String(b))) ||
        item.entities.companies?.some((c) => /kaspi/i.test(String(c))) ||
        item.entities.numbers?.includes(12000),
      "expected at least one grounded entity on the extracted item"
    );
  });

  await test("empty bag helper", () => {
    assert.equal(isEntityBagEmpty(createEmptyEntityBag()), true);
    assert.equal(isEntityBagEmpty(extractEntities("Kaspi")), false);
  });

  if (process.exitCode) console.error("\nSome entity-extraction tests failed.");
  else console.log("\nAll entity-extraction tests passed.");
}

run();
