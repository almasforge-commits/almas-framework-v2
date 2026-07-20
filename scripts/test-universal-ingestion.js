/**
 * Universal Knowledge Ingestion pipeline tests.
 * No Telegram, no live network, no package installs.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNormalizedDocument,
  checksumText,
  detectLanguageHint,
  chunkDocumentContent,
  createIsolatedIngestionPipeline,
} from "../services/ingestion/index.js";
import {
  adaptText,
  adaptMarkdown,
  adaptHtml,
  adaptPdf,
  adaptDocx,
  adaptWeb,
  adaptYouTube,
  FUTURE_ADAPTERS,
  stripHtml,
} from "../sourceAdapters/index.js";
import {
  createInMemoryKnowledgeRepository,
  isKnowledgeRepository,
} from "../repositories/index.js";

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

await test("plain text normalization", async () => {
  const doc = adaptText({
    text: "Hello ALMAS knowledge.",
    title: "Note",
    author: "Almas",
  });
  assert.equal(doc.sourceType, "text");
  assert.equal(doc.title, "Note");
  assert.equal(doc.author, "Almas");
  assert.ok(doc.checksum);
  assert.ok(doc.content.includes("ALMAS"));
  assert.equal(doc.metadata.mimeType, "text/plain");
});

await test("Markdown normalization + sections", async () => {
  const md = `# Spec\n\nIntro\n\n## Goals\n\nShip pipeline\n\n## Notes\n\nDetails`;
  const doc = adaptMarkdown({ text: md });
  assert.equal(doc.sourceType, "markdown");
  assert.equal(doc.title, "Spec");
  assert.ok(doc.sections.length >= 2);
  assert.equal(doc.sections[0].title, "Goals");
});

await test("HTML normalization", async () => {
  const html =
    "<html><head><title>Page T</title></head><body><script>x</script><p>Hello <b>world</b></p></body></html>";
  const doc = adaptHtml({ html });
  assert.equal(doc.sourceType, "html");
  assert.equal(doc.title, "Page T");
  assert.ok(!doc.content.includes("<script"));
  assert.ok(doc.content.includes("Hello"));
  assert.ok(doc.content.includes("world"));
});

await test("PDF normalization (pre-extracted text)", async () => {
  const doc = adaptPdf({
    text: "PDF body about WHOOP recovery.",
    title: "Report",
    author: "Lab",
  });
  assert.equal(doc.sourceType, "pdf");
  assert.equal(doc.metadata.mimeType, "application/pdf");
  assert.ok(doc.content.includes("WHOOP"));
  assert.throws(() => adaptPdf({ buffer: Buffer.from("x") }), /pdf_parser_unavailable/);
});

await test("DOCX normalization (text + xml strip)", async () => {
  const doc = adaptDocx({
    text: "DOCX contract text",
    title: "Contract",
  });
  assert.equal(doc.sourceType, "docx");
  const fromXml = adaptDocx({
    xml: "<w:p><w:t>Hello</w:t></w:p><w:p><w:t>World</w:t></w:p>",
    title: "X",
  });
  assert.ok(/Hello/i.test(fromXml.content));
});

await test("Web adapter uses injected fetch / HTML body", async () => {
  const doc = await adaptWeb(
    { url: "https://example.com/a" },
    {
      fetchFn: async () => ({
        html: "<html><title>Ex</title><body><p>Fetched</p></body></html>",
        title: "Ex",
      }),
    }
  );
  assert.equal(doc.sourceType, "html");
  assert.ok(doc.content.includes("Fetched"));
});

await test("YouTube compatibility (reuse info loader)", async () => {
  const doc = await adaptYouTube(
    { url: "https://youtu.be/abc", transcript: "Talk about RAG systems." },
    {
      getYouTubeVideoInfoFn: async () => ({
        title: "RAG Talk",
        channel: "ALMAS",
        duration: "12:01",
      }),
    }
  );
  assert.equal(doc.sourceType, "youtube");
  assert.equal(doc.title, "RAG Talk");
  assert.equal(doc.author, "ALMAS");
  assert.ok(doc.content.includes("RAG"));
  assert.equal(doc.metadata.duration, "12:01");
});

await test("checksum + language detection", async () => {
  assert.equal(checksumText("abc"), checksumText("abc"));
  assert.notEqual(checksumText("abc"), checksumText("abd"));
  assert.equal(detectLanguageHint("Привет мир это тест"), "ru");
  assert.equal(detectLanguageHint("Hello world this is a test"), "en");
});

await test("chunking stable ids + overlap", async () => {
  const long = ("word ".repeat(800)).trim();
  const chunks = chunkDocumentContent(long, {
    documentId: "doc1",
    chunkSize: 100,
    chunkOverlap: 20,
  });
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].id.startsWith("doc1:chunk:0:"), true);
  assert.ok(chunks[0].checksum);
  assert.equal(chunks[0].embedding, null);
  const again = chunkDocumentContent(long, {
    documentId: "doc1",
    chunkSize: 100,
    chunkOverlap: 20,
  });
  assert.deepEqual(
    chunks.map((c) => c.id),
    again.map((c) => c.id)
  );
});

await test("metadata / provenance preservation through pipeline", async () => {
  const pipeline = createIsolatedIngestionPipeline({
    env: { INGESTION_MODE: "shadow" },
    extractUniversalInformationFn: async () => ({
      items: [
        {
          index: 0,
          kind: "knowledge",
          content: "WHOOP recovery note",
          confidence: 0.9,
          entities: [],
          relationships: [],
        },
      ],
      tier: "deterministic",
      reasonCode: "ok",
    }),
    enrichEntitiesFn: (items) =>
      items.map((i) => ({ ...i, entities: [{ type: "product", value: "WHOOP" }] })),
    enrichRelationshipsFn: (items) =>
      items.map((i) => ({
        ...i,
        relationships: [{ type: "mentions", target: "WHOOP" }],
      })),
  });

  const result = await pipeline.ingest({
    sourceType: "pdf",
    raw: {
      text: "WHOOP recovery improved this week.",
      title: "Health PDF",
      author: "Almas",
      url: "file://report.pdf",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "shadow");
  assert.equal(result.document.author, "Almas");
  assert.equal(result.provenance.mimeType, "application/pdf");
  assert.equal(result.provenance.checksum, result.document.checksum);
  assert.ok(result.chunks.length >= 1);
  assert.equal(result.items[0].entities[0].value, "WHOOP");
  assert.equal(result.items[0].relationships[0].target, "WHOOP");
  assert.equal(result.personalKnowledge.written, false);
  assert.ok(result.knowledge);
  assert.equal(result.knowledge.shadow, true);
  assert.equal(result.storageSkipped, false);
});

await test("dry_run skips storage; shadow writes injected repo", async () => {
  const repo = createInMemoryKnowledgeRepository();
  const pipeline = createIsolatedIngestionPipeline({
    knowledgeRepository: repo,
    extractUniversalInformationFn: async () => ({ items: [], tier: "none" }),
    enrichEntitiesFn: (i) => i,
    enrichRelationshipsFn: (i) => i,
  });

  const dry = await pipeline.ingest({
    mode: "dry_run",
    sourceType: "text",
    raw: { text: "Only dry", title: "D" },
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.storageSkipped, true);
  assert.equal(await repo.size(), 0);

  const shadow = await pipeline.ingest({
    mode: "shadow",
    sourceType: "text",
    raw: { text: "Shadow store", title: "S" },
  });
  assert.equal(shadow.storageSkipped, false);
  assert.equal(await repo.size(), 1);
  assert.equal(isKnowledgeRepository(repo), true);
});

await test("repository injection", async () => {
  let upserted = 0;
  const fakeRepo = {
    upsert: async (r) => {
      upserted += 1;
      return { record: r, created: true };
    },
    getById: async () => null,
    list: async () => [],
    clear: async () => {},
    size: async () => upserted,
  };
  const pipeline = createIsolatedIngestionPipeline({
    knowledgeRepository: fakeRepo,
    extractUniversalInformationFn: async () => ({ items: [] }),
    enrichEntitiesFn: (i) => i,
    enrichRelationshipsFn: (i) => i,
  });
  await pipeline.ingest({
    mode: "shadow",
    sourceType: "markdown",
    raw: { text: "# Hi\n\nBody", title: "Hi" },
  });
  assert.equal(upserted, 1);
});

await test("Universal / Entity / Relationship compatibility (reuse modules)", async () => {
  const pipeline = createIsolatedIngestionPipeline({
    // Use real UE with no AI provider (deterministic path only).
    extractUniversalInformationFn: async (text, opts) => {
      assert.equal(opts.allowDefaultProvider, false);
      return {
        items: [
          {
            index: 0,
            kind: "idea",
            content: text.slice(0, 80),
            confidence: 0.8,
            entities: [],
            relationships: [],
          },
        ],
        tier: "deterministic",
        reasonCode: "ok",
      };
    },
  });
  // Use real entity/relationship enrichers from pipeline defaults.
  const result = await pipeline.ingest({
    mode: "dry_run",
    sourceType: "text",
    raw: { text: "Идея: построить ingestion pipeline для ALMAS." },
  });
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items[0].entities !== undefined);
  assert.ok(result.items[0].relationships !== undefined);
});

await test("future adapters are interfaces only", async () => {
  await assert.rejects(() => FUTURE_ADAPTERS.image(), /image_ocr_not_implemented/);
  await assert.rejects(() => FUTURE_ADAPTERS.whoop(), /whoop_adapter_not_implemented/);
  await assert.rejects(() => FUTURE_ADAPTERS.email(), /email_adapter_not_implemented/);
});

await test("no Telegram / Answer Engine / execution coupling", async () => {
  const dirs = [
    join(root, "services/ingestion"),
    join(root, "sourceAdapters"),
  ];
  const forbidden = [
    "messageHandler",
    "node-telegram-bot-api",
    "actionExecutor",
    "addExpense",
    "saveMemory",
    "createTask",
    "answerEngine",
    "decideRouting",
  ];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const text = readFileSync(join(dir, f), "utf8");
      for (const bad of forbidden) {
        assert.ok(!text.includes(bad), `${f} must not contain ${bad}`);
      }
    }
  }
  assert.ok(typeof stripHtml === "function");
  assert.ok(createNormalizedDocument({ content: "x" }).id);
});

console.log(`\nuniversal-ingestion: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
