import assert from "node:assert/strict";

import { chunkText } from "../core/utils/chunkText.js";

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

function assertInvariants(chunks, sourceText) {
  const trimmedSource = sourceText.trim();

  chunks.forEach((chunk, i) => {
    // Monotonic, zero-based indexes.
    assert.equal(chunk.index, i, "chunk.index must be monotonic starting at 0");

    // Valid char ranges: charEnd - charStart must equal content.length,
    // and slicing the source at [charStart, charEnd) must reproduce content.
    assert.equal(
      chunk.charEnd - chunk.charStart,
      chunk.content.length,
      "charEnd - charStart must equal content.length"
    );
    assert.equal(
      trimmedSource.slice(chunk.charStart, chunk.charEnd),
      chunk.content,
      "content must match the source slice at [charStart, charEnd)"
    );

    assert.ok(chunk.tokenCount > 0, "tokenCount must be positive");
  });

  // Forward progress + no identical consecutive chunks.
  for (let i = 1; i < chunks.length; i++) {
    const previous = chunks[i - 1];
    const current = chunks[i];

    assert.ok(current.charStart > previous.charStart, "expected forward progress between chunks");
    assert.ok(
      !(current.charStart === previous.charStart && current.charEnd === previous.charEnd),
      "consecutive chunks must not be identical"
    );
  }
}

test("null input returns no chunks", () => {
  assert.deepEqual(chunkText(null), []);
});

test("undefined input returns no chunks", () => {
  assert.deepEqual(chunkText(undefined), []);
});

test("empty string returns no chunks", () => {
  assert.deepEqual(chunkText(""), []);
});

test("whitespace-only input returns no chunks", () => {
  assert.deepEqual(chunkText("   \n\t  \n  "), []);
});

test("short English text returns a single chunk covering the whole text", () => {
  const text = "This is a short note about ALMAS.";
  const chunks = chunkText(text, { maxChars: 2000, overlapChars: 200 });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[0].content, text);
  assert.equal(chunks[0].charStart, 0);
  assert.equal(chunks[0].charEnd, text.length);
  assert.ok(chunks[0].tokenCount > 0);
});

test("short Cyrillic text returns a single chunk covering the whole text", () => {
  const text = "ALMAS помнит всё, что рассказывает пользователь.";
  const chunks = chunkText(text, { maxChars: 2000, overlapChars: 200 });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, text);
  assert.equal(chunks[0].charStart, 0);
  assert.equal(chunks[0].charEnd, text.length);
});

test("input exactly at maxChars length returns a single chunk", () => {
  const text = "a".repeat(500);
  const chunks = chunkText(text, { maxChars: 500, overlapChars: 50 });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, text);
  assert.equal(chunks[0].charEnd - chunks[0].charStart, 500);
});

test("long English input is split into multiple valid chunks", () => {
  const paragraph = "ALMAS remembers everything the user tells it. ";
  const text = paragraph.repeat(200); // ~9600 chars

  const chunks = chunkText(text, { maxChars: 2000, overlapChars: 200 });

  assert.ok(chunks.length > 1, "expected more than one chunk");
  chunks.forEach((chunk) => {
    assert.ok(chunk.content.length <= 2000 + 1, "chunk should respect maxChars (allowing boundary snap)");
  });
  assertInvariants(chunks, text);
});

test("long Cyrillic transcript is split into multiple valid chunks", () => {
  const paragraph = "АЛМАС запоминает всё, что рассказывает пользователь, и находит это позже. ";
  const text = paragraph.repeat(150);

  const chunks = chunkText(text, { maxChars: 1500, overlapChars: 150 });

  assert.ok(chunks.length > 1, "expected more than one chunk");
  assertInvariants(chunks, text);
});

test("long text without any punctuation still splits safely", () => {
  // No spaces, newlines, or sentence terminators at all — boundary
  // snapping has nothing to latch onto and must fall back to a hard cut.
  const text = "a".repeat(10000);

  const chunks = chunkText(text, { maxChars: 1000, overlapChars: 100 });

  assert.ok(chunks.length > 1, "expected more than one chunk");
  chunks.forEach((chunk) => {
    assert.ok(chunk.content.length <= 1000, "hard cut must still respect maxChars");
  });
  assertInvariants(chunks, text);
});

test("multiple paragraphs snap chunk boundaries to paragraph breaks where possible", () => {
  const paragraphs = [];
  for (let i = 0; i < 40; i++) {
    paragraphs.push(`Paragraph number ${i} about ALMAS and its knowledge engine design.`);
  }
  const text = paragraphs.join("\n\n");

  const chunks = chunkText(text, { maxChars: 300, overlapChars: 30 });

  assert.ok(chunks.length > 1, "expected more than one chunk");
  assertInvariants(chunks, text);
});

test("overlapChars = 0 produces no overlap between consecutive chunks", () => {
  const paragraph = "Knowledge is the most valuable asset ALMAS produces. ";
  const text = paragraph.repeat(150);

  const chunks = chunkText(text, { maxChars: 1000, overlapChars: 0 });

  assert.ok(chunks.length > 1, "expected more than one chunk to check overlap");
  assertInvariants(chunks, text);

  for (let i = 1; i < chunks.length; i++) {
    assert.ok(
      chunks[i].charStart >= chunks[i - 1].charEnd,
      "with overlapChars = 0, chunks must not overlap"
    );
  }
});

test("normal overlap: consecutive chunks overlap by roughly overlapChars", () => {
  const paragraph = "Knowledge is the most valuable asset ALMAS produces. ";
  const text = paragraph.repeat(150);

  const chunks = chunkText(text, { maxChars: 1000, overlapChars: 150 });

  assert.ok(chunks.length > 1, "expected more than one chunk to check overlap");
  assertInvariants(chunks, text);

  for (let i = 1; i < chunks.length; i++) {
    const previous = chunks[i - 1];
    const current = chunks[i];

    assert.ok(current.charStart < previous.charEnd, "expected overlap with previous chunk");
  }
});

test("overlapChars >= maxChars throws", () => {
  assert.throws(() => chunkText("some text", { maxChars: 100, overlapChars: 100 }));
  assert.throws(() => chunkText("some text", { maxChars: 100, overlapChars: 150 }));
});

test("invalid maxChars throws", () => {
  assert.throws(() => chunkText("some text", { maxChars: 0 }));
  assert.throws(() => chunkText("some text", { maxChars: -10 }));
  assert.throws(() => chunkText("some text", { maxChars: NaN }));
});

test("invalid overlapChars throws", () => {
  assert.throws(() => chunkText("some text", { maxChars: 100, overlapChars: -1 }));
  assert.throws(() => chunkText("some text", { maxChars: 100, overlapChars: NaN }));
});

test("very small maxChars does not hang and produces valid chunks", () => {
  const text = "ALMAS remembers everything the user tells it, across many sources.";

  const chunks = chunkText(text, { maxChars: 5, overlapChars: 1 });

  assert.ok(chunks.length > 1, "expected many small chunks");
  assertInvariants(chunks, text);
  chunks.forEach((chunk) => {
    assert.ok(chunk.content.length > 0, "no empty chunks");
  });
});

test("very small maxChars with overlapChars = 0 does not hang", () => {
  const text = "ALMAS remembers everything the user tells it, across many sources.";

  const chunks = chunkText(text, { maxChars: 3, overlapChars: 0 });

  assert.ok(chunks.length > 1);
  assertInvariants(chunks, text);
});

test("chunk indexes are monotonic and char ranges are valid across a realistic transcript", () => {
  const sentences = [];
  for (let i = 0; i < 80; i++) {
    sentences.push(`This is sentence number ${i} in a simulated transcript about personal knowledge management.`);
  }
  const text = sentences.join(" ");

  const chunks = chunkText(text, { maxChars: 400, overlapChars: 50 });

  assertInvariants(chunks, text);
});

test("reconstruction sanity check: concatenated unique spans cover the source, allowing overlap", () => {
  const paragraph = "ALMAS is a personal AI operating system. ";
  const text = paragraph.repeat(100);

  const chunks = chunkText(text, { maxChars: 500, overlapChars: 80 });

  assertInvariants(chunks, text);

  // Every char position in the trimmed source should be covered by at
  // least one chunk (overlap means some positions are covered twice).
  const trimmed = text.trim();
  const covered = new Array(trimmed.length).fill(false);
  for (const chunk of chunks) {
    for (let i = chunk.charStart; i < chunk.charEnd; i++) {
      covered[i] = true;
    }
  }
  assert.ok(covered.every(Boolean), "every character of the source must be covered by some chunk");
});

if (process.exitCode) {
  console.error("\nSome chunkText tests failed.");
} else {
  console.log("\nAll chunkText tests passed.");
}
