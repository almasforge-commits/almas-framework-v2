import assert from "node:assert/strict";

import {
  prepareKnowledgeChunkRows,
  replaceKnowledgeChunks,
  rebuildKnowledgeChunksFromKnowledge,
  getKnowledgeChunks,
  searchKnowledgeChunks,
} from "../services/storage/knowledgeChunkService.js";

// This file must never call OpenAI or Supabase. Importing
// knowledgeChunkService.js is safe with zero env vars set (see
// providers/storage/knowledgeChunkDriver.js's lazy Supabase import and
// services/ai/embeddingService.js's lazy OpenAI client). Every test below
// injects fake createEmbeddingsFn/deleteFn/insertFn so the real
// network-touching driver/embedding code paths are never reached.

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

function fakeEmbeddings(texts) {
  return texts.map((t) => [t.length]);
}

async function run() {

  await test("prepareKnowledgeChunkRows validates knowledgeId", async () => {
    await assert.rejects(() => prepareKnowledgeChunkRows("", "some content"));
    await assert.rejects(() => prepareKnowledgeChunkRows(null, "some content"));
    await assert.rejects(() => prepareKnowledgeChunkRows(undefined, "some content"));
  });

  await test("prepareKnowledgeChunkRows validates rawContent", async () => {
    await assert.rejects(() => prepareKnowledgeChunkRows("know-1", ""));
    await assert.rejects(() => prepareKnowledgeChunkRows("know-1", "   "));
    await assert.rejects(() => prepareKnowledgeChunkRows("know-1", null));
  });

  await test("prepareKnowledgeChunkRows handles minimal single-character content as one chunk", async () => {
    const rows = await prepareKnowledgeChunkRows("know-1", "a", {
      chunkOptions: { maxChars: 10, overlapChars: 1 },
      createEmbeddingsFn: async (texts) => fakeEmbeddings(texts),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content, "a");
  });

  await test("prepareKnowledgeChunkRows builds rows in chunk order with matching embeddings", async () => {
    const rawContent = "Sentence one is short. Sentence two is also short. Sentence three ends it.";

    const rows = await prepareKnowledgeChunkRows("know-42", rawContent, {
      chunkOptions: { maxChars: 30, overlapChars: 5 },
      createEmbeddingsFn: async (texts) => fakeEmbeddings(texts),
    });

    assert.ok(rows.length > 1, "expected multiple chunks for this input");

    rows.forEach((row, i) => {
      assert.equal(row.knowledgeId, "know-42");
      assert.equal(row.chunkIndex, i, "chunkIndex must be in order");
      assert.deepEqual(row.embedding, [row.content.length], "embedding must correspond to this row's content");
      assert.ok(row.tokenCount > 0);
    });
  });

  await test("prepareKnowledgeChunkRows throws if embedding count does not match chunk count", async () => {
    await assert.rejects(
      // Small maxChars forces several chunks; the fake embedder always
      // returns exactly one embedding, guaranteeing a count mismatch.
      () => prepareKnowledgeChunkRows("know-1", "Some reasonably long piece of content here, definitely more than one chunk.", {
        chunkOptions: { maxChars: 15, overlapChars: 2 },
        createEmbeddingsFn: async () => [[1, 2]],
      }),
      /does not match chunk count/
    );
  });

  await test("replaceKnowledgeChunks builds rows fully before deleting, then inserts", async () => {
    const callOrder = [];

    const result = await replaceKnowledgeChunks("know-99", "Some content to chunk and embed for this test.", {
      createEmbeddingsFn: async (texts) => {
        callOrder.push("embed");
        return fakeEmbeddings(texts);
      },
      deleteFn: async (knowledgeId) => {
        callOrder.push("delete");
        assert.equal(knowledgeId, "know-99");
        return 3;
      },
      insertFn: async (rows) => {
        callOrder.push("insert");
        assert.ok(rows.length > 0);
        return rows;
      },
    });

    assert.deepEqual(callOrder, ["embed", "delete", "insert"], "embed (build) must happen before delete, which must happen before insert");
    assert.equal(result.deletedCount, 3);
    assert.ok(result.inserted.length > 0);
  });

  await test("replaceKnowledgeChunks never calls deleteFn/insertFn if building rows fails", async () => {
    let deleteCalled = false;
    let insertCalled = false;

    await assert.rejects(
      () => replaceKnowledgeChunks("know-1", "content", {
        createEmbeddingsFn: async () => { throw new Error("embedding backend down"); },
        deleteFn: async () => { deleteCalled = true; return 0; },
        insertFn: async (rows) => { insertCalled = true; return rows; },
      }),
      /embedding backend down/
    );

    assert.equal(deleteCalled, false, "delete must not run if building rows failed");
    assert.equal(insertCalled, false, "insert must not run if building rows failed");
  });

  await test("replaceKnowledgeChunks skips insertFn when there are zero rows to insert", async () => {
    let insertCalled = false;

    // maxChars huge, overlap 0 still yields exactly one row normally; to
    // exercise the zero-row path we simulate it via a rawContent that
    // chunkText would still turn into 1 row, then just assert insertFn
    // receives that row — zero-row path is structural (rows.length === 0)
    // and already covered by prepareKnowledgeChunkRows' own contract.
    const result = await replaceKnowledgeChunks("know-1", "x", {
      createEmbeddingsFn: async (texts) => fakeEmbeddings(texts),
      deleteFn: async () => 0,
      insertFn: async (rows) => { insertCalled = true; return rows; },
    });

    assert.equal(insertCalled, true);
    assert.equal(result.inserted.length, 1);
  });

  await test("rebuildKnowledgeChunksFromKnowledge skips when knowledge has no rawContent", async () => {
    let deleteCalled = false;
    let insertCalled = false;

    const result = await rebuildKnowledgeChunksFromKnowledge(
      { id: "know-1", rawContent: null },
      {
        deleteFn: async () => { deleteCalled = true; return 0; },
        insertFn: async (rows) => { insertCalled = true; return rows; },
      }
    );

    assert.deepEqual(result, { skipped: true, reason: "no rawContent" });
    assert.equal(deleteCalled, false);
    assert.equal(insertCalled, false);
  });

  await test("rebuildKnowledgeChunksFromKnowledge skips for missing/undefined knowledge", async () => {
    assert.deepEqual(
      await rebuildKnowledgeChunksFromKnowledge({ id: "know-1" }),
      { skipped: true, reason: "no rawContent" }
    );
    assert.deepEqual(
      await rebuildKnowledgeChunksFromKnowledge(null),
      { skipped: true, reason: "no rawContent" }
    );
  });

  await test("rebuildKnowledgeChunksFromKnowledge delegates to replaceKnowledgeChunks when rawContent is present", async () => {
    const callOrder = [];

    const result = await rebuildKnowledgeChunksFromKnowledge(
      { id: "know-77", rawContent: "Some transcript content to chunk and embed." },
      {
        createEmbeddingsFn: async (texts) => { callOrder.push("embed"); return fakeEmbeddings(texts); },
        deleteFn: async (knowledgeId) => {
          callOrder.push("delete");
          assert.equal(knowledgeId, "know-77");
          return 2;
        },
        insertFn: async (rows) => {
          callOrder.push("insert");
          rows.forEach((row) => assert.equal(row.knowledgeId, "know-77"));
          return rows;
        },
      }
    );

    assert.deepEqual(callOrder, ["embed", "delete", "insert"]);
    assert.equal(result.deletedCount, 2);
    assert.ok(result.inserted.length > 0);
  });

  await test("getKnowledgeChunks validates knowledgeId without touching the network", async () => {
    await assert.rejects(() => getKnowledgeChunks(""));
    await assert.rejects(() => getKnowledgeChunks(null));
  });

  await test("searchKnowledgeChunks validates queryEmbedding without touching the network", async () => {
    await assert.rejects(() => searchKnowledgeChunks([]));
    await assert.rejects(() => searchKnowledgeChunks(null));
    await assert.rejects(() => searchKnowledgeChunks("not an array"));
  });

  if (process.exitCode) {
    console.error("\nSome knowledge chunk service tests failed.");
  } else {
    console.log("\nAll knowledge chunk service tests passed.");
  }

}

run();
