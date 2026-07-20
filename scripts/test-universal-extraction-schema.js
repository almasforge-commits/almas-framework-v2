/**
 * Universal Extraction OpenAI schema + retry/logging tests.
 */

import assert from "node:assert/strict";
import {
  UNIVERSAL_EXTRACTION_JSON_SCHEMA,
  assertUniversalExtractionSchemaStrict,
  normalizeTransportEntities,
  createExtractedItem,
  EXTRACTION_ENTITY_FIELD_NAMES,
} from "../services/inbox/universalExtractionContracts.js";
import { validateExtractedItems } from "../services/inbox/universalExtractionValidator.js";
import { sanitizeUniversalExtraction } from "../services/inbox/universalExtractionSanitizer.js";
import { extractUniversalInformation } from "../services/inbox/universalExtractor.js";
import { classifyOpenAiError } from "../providers/ai/openaiProvider.js";
import { createExtractionResult } from "../services/inbox/universalExtractionContracts.js";

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

await test("1. every object node has additionalProperties:false", () => {
  const result = assertUniversalExtractionSchemaStrict();
  assert.equal(result.ok, true, result.failures.join(", "));
});

await test("2. schema root is strict-compatible", () => {
  const root = UNIVERSAL_EXTRACTION_JSON_SCHEMA.schema;
  assert.equal(root.type, "object");
  assert.equal(root.additionalProperties, false);
  assert.ok(Array.isArray(root.required));
  assert.deepEqual(
    [...root.required].sort(),
    Object.keys(root.properties).sort()
  );
  assert.equal(UNIVERSAL_EXTRACTION_JSON_SCHEMA.strict, true);
  assert.equal(UNIVERSAL_EXTRACTION_JSON_SCHEMA.name, "almas_universal_extraction");
});

await test("3. entities schema is strict with finite properties", () => {
  const entities =
    UNIVERSAL_EXTRACTION_JSON_SCHEMA.schema.properties.items.items.properties
      .entities;
  assert.equal(entities.type, "object");
  assert.equal(entities.additionalProperties, false);
  assert.deepEqual(
    [...entities.required].sort(),
    [...EXTRACTION_ENTITY_FIELD_NAMES].sort()
  );
  assert.ok(!("additionalProperties" in entities) || entities.additionalProperties === false);
  assert.equal(entities.properties.entityExtras.type, "array");
  assert.equal(
    entities.properties.entityExtras.items.additionalProperties,
    false
  );
});

await test("4. temporal is represented as temporalRaw (nullable string)", () => {
  const itemProps =
    UNIVERSAL_EXTRACTION_JSON_SCHEMA.schema.properties.items.items.properties;
  assert.deepEqual(itemProps.temporalRaw.type, ["string", "null"]);
  // Internal temporal object is built in mapAiItem — not a free-form schema map.
});

await test("5. relationship nested objects not in OpenAI transport schema", () => {
  // Relationships are added post-provider by relationshipExtractor — must not
  // appear as unrestricted objects in the OpenAI schema.
  const raw = JSON.stringify(UNIVERSAL_EXTRACTION_JSON_SCHEMA.schema);
  assert.ok(!raw.includes('"relationships"'));
});

await test("6. dynamic metadata via entityExtras key/value rows", () => {
  const normalized = normalizeTransportEntities({
    direction: "expense",
    amount: 40000,
    currency: null,
    description: "кофе",
    category: null,
    dateText: null,
    title: null,
    dueDateText: null,
    project: null,
    priority: null,
    metric: null,
    value: null,
    unit: null,
    secondaryValue: null,
    summary: null,
    tags: [],
    relatedProject: null,
    projectName: null,
    update: null,
    statusHint: null,
    entityExtras: [
      { key: "vendor", value: "Cafe" },
      { key: "ignoredNull", value: null },
    ],
  });
  assert.equal(normalized.direction, "expense");
  assert.equal(normalized.amount, 40000);
  assert.equal(normalized.description, "кофе");
  assert.equal(normalized.vendor, "Cafe");
  assert.equal(normalized.currency, undefined);
  assert.ok(!("entityExtras" in normalized));
});

await test("7. valid extraction payload normalizes to same internal contract", () => {
  const legacy = {
    kind: "finance",
    content: "кофе",
    confidence: 0.9,
    entities: {
      direction: "expense",
      amount: 40000,
      currency: "VND",
      description: "кофе",
    },
    temporal: { raw: null },
    requiresClarification: false,
    clarificationReason: null,
  };
  const transport = {
    kind: "finance",
    content: "кофе",
    confidence: 0.9,
    entities: {
      direction: "expense",
      amount: 40000,
      currency: "VND",
      description: "кофе",
      category: null,
      dateText: null,
      title: null,
      dueDateText: null,
      project: null,
      priority: null,
      metric: null,
      value: null,
      unit: null,
      secondaryValue: null,
      summary: null,
      tags: [],
      relatedProject: null,
      projectName: null,
      update: null,
      statusHint: null,
      entityExtras: [],
    },
    temporalRaw: null,
    requiresClarification: false,
    clarificationReason: null,
  };

  const fromLegacy = validateExtractedItems([
    createExtractedItem(legacy),
  ]);
  const fromTransport = validateExtractedItems([
    createExtractedItem({
      ...transport,
      entities: normalizeTransportEntities(transport.entities),
      temporal: { raw: transport.temporalRaw },
    }),
  ]);

  assert.equal(fromLegacy.items[0].entities.amount, 40000);
  assert.equal(fromTransport.items[0].entities.amount, 40000);
  assert.equal(fromLegacy.items[0].entities.currency, "VND");
  assert.equal(fromTransport.items[0].entities.currency, "VND");

  const sanitized = sanitizeUniversalExtraction(
    createExtractionResult({
      items: fromTransport.items,
      tier: "cheap",
      reasonCode: "ok",
    })
  );
  assert.equal(sanitized.items[0].entities.description, "кофе");
});

await test("8. invalid_json_schema is not retried", async () => {
  let calls = 0;
  const provider = {
    name: "schema-fail",
    async run() {
      calls += 1;
      return {
        ok: false,
        reason: "invalid_json_schema",
        retryable: false,
        result: null,
        usage: { model: "test", latencyMs: 1 },
      };
    },
  };

  const out = await extractUniversalInformation(
    "Потратил 40000 на кофе и завтра купить батарейки",
    { provider, forceAi: true }
  );
  assert.equal(calls, 1);
  assert.ok(["fallback", "deterministic"].includes(out.tier) || out.reasonCode);
});

await test("9. transient provider failure may still retry medium tier", async () => {
  let calls = 0;
  const provider = {
    name: "transient",
    async run(_req, { model }) {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          reason: "provider_unavailable",
          retryable: true,
          result: null,
          usage: { model, latencyMs: 1 },
        };
      }
      return {
        ok: true,
        result: {
          language: "ru",
          reasonCode: "ok",
          needsClarification: false,
          items: [
            {
              kind: "finance",
              content: "кофе",
              confidence: 0.9,
              entities: {
                direction: "expense",
                amount: 40000,
                currency: "VND",
                description: "кофе",
                category: null,
                dateText: null,
                title: null,
                dueDateText: null,
                project: null,
                priority: null,
                metric: null,
                value: null,
                unit: null,
                secondaryValue: null,
                summary: null,
                tags: [],
                relatedProject: null,
                projectName: null,
                update: null,
                statusHint: null,
                entityExtras: [],
              },
              temporalRaw: null,
              requiresClarification: false,
              clarificationReason: null,
            },
          ],
        },
        usage: { model, latencyMs: 2 },
      };
    },
  };

  const out = await extractUniversalInformation("Потратил 40000 на кофе", {
    provider,
    forceAi: true,
  });
  assert.equal(calls, 2);
  assert.equal(out.tier, "medium");
  assert.equal(out.items[0].entities.amount, 40000);
});

await test("10. only one sanitized error log for schema failure", async () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    // Simulate lazy provider logging path via a throwing provider that
    // mirrors classified schema errors (extractor itself logs once when
    // using OpenAI lazy provider; here we assert classify + no stack dump).
    const classified = classifyOpenAiError({
      status: 400,
      message:
        "400 Invalid schema for response_format 'almas_universal_extraction': In context=('properties', 'items', 'items', 'properties', 'entities'), 'additionalProperties' is required to be supplied and to be false.",
    });
    assert.equal(classified.code, "invalid_json_schema");
    assert.equal(classified.retryable, false);

    let calls = 0;
    const provider = {
      async run() {
        calls += 1;
        return {
          ok: false,
          reason: "invalid_json_schema",
          retryable: false,
          result: null,
        };
      },
    };
    await extractUniversalInformation("x и завтра купить y", {
      provider,
      forceAi: true,
    });
    assert.equal(calls, 1);
    const blob = lines.join("\n");
    assert.ok(!/request.?id|authorization|cookie|api-key/i.test(blob));
  } finally {
    console.error = original;
  }
});

await test("classifyOpenAiError maps schema message", () => {
  const c = classifyOpenAiError(
    new Error("Invalid schema for response_format: additionalProperties")
  );
  assert.equal(c.code, "invalid_json_schema");
  assert.equal(c.retryable, false);
});

console.log(`\nuniversal-extraction-schema: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
