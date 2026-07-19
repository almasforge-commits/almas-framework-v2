import assert from "node:assert/strict";

import { createEmbeddings, splitIntoBatches } from "../services/ai/embeddingService.js";

// This file must never call OpenAI. `createEmbeddings` accepts an
// injectable `embedBatch` (default calls OpenAI); every test below
// supplies a fake one instead. Importing embeddingService.js itself is
// safe with no OPENAI_API_KEY set, because the real client is now
// constructed lazily on first real use, not at import time.

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

function fakeEmbedding(text) {
  // Deterministic, cheap "embedding": [length, first char code].
  return [text.length, text.charCodeAt(0) || 0];
}

async function run() {

  await test("splitIntoBatches splits evenly", () => {
    const batches = splitIntoBatches(["a", "b", "c", "d", "e"], 2);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches[0], { startIndex: 0, texts: ["a", "b"] });
    assert.deepEqual(batches[1], { startIndex: 2, texts: ["c", "d"] });
    assert.deepEqual(batches[2], { startIndex: 4, texts: ["e"] });
  });

  await test("splitIntoBatches with batchSize >= length returns one batch", () => {
    const batches = splitIntoBatches(["a", "b"], 10);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0], { startIndex: 0, texts: ["a", "b"] });
  });

  await test("splitIntoBatches rejects invalid batchSize", () => {
    assert.throws(() => splitIntoBatches(["a"], 0));
    assert.throws(() => splitIntoBatches(["a"], -1));
    assert.throws(() => splitIntoBatches(["a"], 1.5));
  });

  await test("splitIntoBatches rejects non-array input", () => {
    assert.throws(() => splitIntoBatches("not an array", 2));
  });

  await test("createEmbeddings with empty array returns empty array, no calls made", async () => {
    let called = false;
    const result = await createEmbeddings([], {
      embedBatch: async () => { called = true; return []; },
    });
    assert.deepEqual(result, []);
    assert.equal(called, false, "embedBatch must not be called for an empty input");
  });

  await test("createEmbeddings preserves order across multiple batches", async () => {
    const texts = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];

    const result = await createEmbeddings(texts, {
      batchSize: 3,
      embedBatch: async (batchTexts) => batchTexts.map(fakeEmbedding),
    });

    assert.equal(result.length, texts.length);
    result.forEach((embedding, i) => {
      assert.deepEqual(embedding, fakeEmbedding(texts[i]), `embedding[${i}] must match texts[${i}]`);
    });
  });

  await test("createEmbeddings preserves order with concurrency > 1", async () => {
    const texts = Array.from({ length: 23 }, (_, i) => `item-${i}`);

    const result = await createEmbeddings(texts, {
      batchSize: 5,
      concurrency: 3,
      embedBatch: async (batchTexts) => batchTexts.map(fakeEmbedding),
    });

    assert.equal(result.length, texts.length);
    result.forEach((embedding, i) => {
      assert.deepEqual(embedding, fakeEmbedding(texts[i]));
    });
  });

  await test("createEmbeddings rejects non-array input", async () => {
    await assert.rejects(() => createEmbeddings("not an array"));
  });

  await test("createEmbeddings rejects empty/blank strings in the input", async () => {
    await assert.rejects(
      () => createEmbeddings(["fine", "", "also fine"], {
        embedBatch: async (t) => t.map(fakeEmbedding),
      }),
      /texts\[1\]/
    );

    await assert.rejects(
      () => createEmbeddings(["fine", "   "], {
        embedBatch: async (t) => t.map(fakeEmbedding),
      }),
      /texts\[1\]/
    );
  });

  await test("createEmbeddings rejects invalid batchSize/concurrency", async () => {
    await assert.rejects(() => createEmbeddings(["a"], { batchSize: 0 }));
    await assert.rejects(() => createEmbeddings(["a"], { concurrency: 0 }));
    await assert.rejects(() => createEmbeddings(["a"], { batchSize: -1 }));
  });

  await test("createEmbeddings surfaces batch context when embedBatch fails", async () => {
    const texts = ["a", "b", "c", "d", "e"];

    await assert.rejects(
      () => createEmbeddings(texts, {
        batchSize: 2,
        embedBatch: async (batchTexts) => {
          if (batchTexts.includes("c")) {
            throw new Error("simulated failure");
          }
          return batchTexts.map(fakeEmbedding);
        },
      }),
      (error) => {
        assert.match(error.message, /batch 2\/3/);
        assert.match(error.message, /items 2-3/);
        assert.match(error.message, /simulated failure/);
        return true;
      }
    );
  });

  await test("createEmbeddings rejects a batch that returns the wrong number of embeddings", async () => {
    await assert.rejects(
      () => createEmbeddings(["a", "b"], {
        embedBatch: async () => [[1, 2]], // only one embedding for two inputs
      }),
      /expected 2/
    );
  });

  await test("createEmbeddings never calls the real OpenAI client when embedBatch is injected", async () => {
    // No OPENAI_API_KEY is set in this environment; if createEmbeddings
    // ever fell back to the default embedBatch, constructing the OpenAI
    // client would throw. Reaching a clean result proves the injected
    // embedBatch was used exclusively.
    const result = await createEmbeddings(["only", "injected", "calls"], {
      embedBatch: async (t) => t.map(fakeEmbedding),
    });
    assert.equal(result.length, 3);
  });

  if (process.exitCode) {
    console.error("\nSome embedding batch tests failed.");
  } else {
    console.log("\nAll embedding batch tests passed.");
  }

}

run();
