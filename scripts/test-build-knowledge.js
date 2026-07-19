import assert from "node:assert/strict";

import { buildKnowledge } from "../core/pipeline/steps/buildKnowledge.js";

// buildKnowledge is a pure pipeline step (plain object in, plain object
// out) — no Telegram, no OpenAI, no Supabase. Safe to unit test directly.

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

function baseContext(overrides = {}) {
  return {
    input: { url: "https://youtube.com/watch?v=abc123" },
    metadata: {
      source: {
        type: "youtube",
        title: "Test Video",
        url: "https://youtube.com/watch?v=abc123",
        author: "Test Channel",
        duration: 600,
        extra: {},
      },
    },
    analysis: {
      summary: "A short summary.",
      keyPoints: ["point one", "point two"],
      tags: ["tag1"],
      ideas: ["idea1"],
      tasks: ["task1"],
    },
    transcript: "This is the full transcript text of the video.",
    ...overrides,
  };
}

async function run() {

  await test("buildKnowledge carries the transcript into knowledge.rawContent", async () => {
    const context = baseContext();
    const result = await buildKnowledge(context);

    assert.equal(result.knowledge.rawContent, context.transcript);
  });

  await test("buildKnowledge sets rawContent to null when transcript is missing", async () => {
    const context = baseContext({ transcript: undefined });
    const result = await buildKnowledge(context);

    assert.equal(result.knowledge.rawContent, null);
  });

  await test("buildKnowledge preserves all existing fields unchanged", async () => {
    const context = baseContext();
    const result = await buildKnowledge(context);

    assert.equal(result.knowledge.type, "youtube");
    assert.equal(result.knowledge.title, "Test Video");
    assert.equal(result.knowledge.summary, "A short summary.");
    assert.deepEqual(result.knowledge.keyPoints, ["point one", "point two"]);
    assert.deepEqual(result.knowledge.tags, ["tag1"]);
    assert.deepEqual(result.knowledge.ideas, ["idea1"]);
    assert.deepEqual(result.knowledge.tasks, ["task1"]);
    assert.deepEqual(result.knowledge.source, {
      url: "https://youtube.com/watch?v=abc123",
      author: "Test Channel",
      duration: 600,
    });
  });

  await test("buildKnowledge defaults analysis arrays to [] when missing, same as before", async () => {
    const context = baseContext({ analysis: { summary: "Only a summary." } });
    const result = await buildKnowledge(context);

    assert.deepEqual(result.knowledge.keyPoints, []);
    assert.deepEqual(result.knowledge.tags, []);
    assert.deepEqual(result.knowledge.ideas, []);
    assert.deepEqual(result.knowledge.tasks, []);
    assert.equal(result.knowledge.rawContent, context.transcript);
  });

  await test("buildKnowledge returns the same context object it was given", async () => {
    const context = baseContext();
    const result = await buildKnowledge(context);

    assert.equal(result, context);
  });

  await test("buildKnowledge reads type dynamically from context.metadata.source.type", async () => {
    const context = baseContext({
      metadata: {
        source: {
          type: "pdf",
          title: "A Document",
          url: null,
          author: "Some Author",
          duration: null,
          extra: {},
        },
      },
    });
    const result = await buildKnowledge(context);

    assert.equal(result.knowledge.type, "pdf");
    assert.equal(result.knowledge.title, "A Document");
    assert.deepEqual(result.knowledge.source, {
      url: null,
      author: "Some Author",
      duration: null,
    });
  });

  if (process.exitCode) {
    console.error("\nSome buildKnowledge tests failed.");
  } else {
    console.log("\nAll buildKnowledge tests passed.");
  }

}

run();
