import assert from "node:assert/strict";

import { askKnowledgeChunks } from "../services/chat/knowledgeChunkChatService.js";

// Must never call OpenAI or Supabase. Every dependency is injected via
// options (createEmbeddingFn, searchKnowledgeChunksFn, askAIFn), so
// importing/running this file is safe with zero env vars set.

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (error) {
      console.error(`❌ ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  })();
}

function fakeChunk(overrides = {}) {
  return {
    chunkId: "chunk-1",
    knowledgeId: "know-1",
    content: "Some chunk content.",
    similarity: 0.5,
    knowledgeTitle: "Title A",
    knowledgeType: "youtube",
    knowledgeSource: {},
    ...overrides,
  };
}

async function run() {

  await test("empty question returns null without calling any dependency", async () => {
    let called = false;
    const track = () => { called = true; };

    const result = await askKnowledgeChunks("   ", {
      createEmbeddingFn: track,
      searchKnowledgeChunksFn: track,
      askAIFn: track,
    });

    assert.equal(result, null);
    assert.equal(called, false);
  });

  await test("null/undefined question returns null", async () => {
    assert.equal(await askKnowledgeChunks(null), null);
    assert.equal(await askKnowledgeChunks(undefined), null);
  });

  await test("embedding returning null falls back (null)", async () => {
    let searchCalled = false;

    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => null,
      searchKnowledgeChunksFn: async () => { searchCalled = true; return [fakeChunk()]; },
    });

    assert.equal(result, null);
    assert.equal(searchCalled, false, "must not search chunks if embedding failed");
  });

  await test("embedding throwing falls back (null)", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => { throw new Error("openai down"); },
    });

    assert.equal(result, null);
  });

  await test("chunk search returning [] falls back (null)", async () => {
    let askCalled = false;

    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [],
      askAIFn: async () => { askCalled = true; return { answer: "x", sources: [] }; },
    });

    assert.equal(result, null);
    assert.equal(askCalled, false, "must not call the AI if there are no chunks");
  });

  await test("chunk search throwing falls back (null)", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => { throw new Error("supabase down"); },
    });

    assert.equal(result, null);
  });

  await test("AI call returning null falls back (null)", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [fakeChunk()],
      askAIFn: async () => null,
    });

    assert.equal(result, null);
  });

  await test("AI call throwing falls back (null)", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [fakeChunk()],
      askAIFn: async () => { throw new Error("openai timeout"); },
    });

    assert.equal(result, null);
  });

  await test("AI result missing answer falls back (null)", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [fakeChunk()],
      askAIFn: async () => ({ sources: [] }),
    });

    assert.equal(result, null);
  });

  await test("valid chunks + valid AI result returns answer with filtered sources", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [
        fakeChunk({ knowledgeTitle: "Title A" }),
        fakeChunk({ knowledgeTitle: "Title B" }),
      ],
      askAIFn: async () => ({
        answer: "This is the synthesized answer.",
        sources: ["Title A", "Title B", "Hallucinated Title"],
      }),
    });

    assert.ok(result);
    assert.equal(result.answer, "This is the synthesized answer.");
    assert.deepEqual(result.sources, ["Title A", "Title B"], "must drop sources not in the retrieved chunks");
  });

  await test("duplicate knowledgeTitles across chunks are deduplicated in sources", async () => {
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [
        fakeChunk({ chunkId: "c1", knowledgeTitle: "Same Title" }),
        fakeChunk({ chunkId: "c2", knowledgeTitle: "Same Title" }),
      ],
      askAIFn: async () => ({
        answer: "Answer referencing one source twice.",
        sources: ["Same Title", "Same Title"],
      }),
    });

    assert.deepEqual(result.sources, ["Same Title"]);
  });

  await test("matchThreshold/matchCount options are forwarded to searchKnowledgeChunksFn", async () => {
    let receivedOptions = null;

    await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async (embedding, opts) => { receivedOptions = opts; return []; },
      matchThreshold: 0.42,
      matchCount: 3,
    });

    assert.deepEqual(receivedOptions, { matchThreshold: 0.42, matchCount: 3 });
  });

  await test("never calls the real OpenAI/Supabase code paths when fully injected", async () => {
    // No OPENAI_API_KEY or SUPABASE_URL is set in this environment; if any
    // default (non-injected) dependency were reached, it would throw.
    const result = await askKnowledgeChunks("What is ALMAS?", {
      createEmbeddingFn: async () => [0.1, 0.2],
      searchKnowledgeChunksFn: async () => [fakeChunk()],
      askAIFn: async () => ({ answer: "ok", sources: ["Title A"] }),
    });

    assert.ok(result);
  });

  if (process.exitCode) {
    console.error("\nSome knowledge chunk chat tests failed.");
  } else {
    console.log("\nAll knowledge chunk chat tests passed.");
  }

}

run();
