import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 1;

// Lazily constructed: constructing the OpenAI SDK client throws
// immediately if OPENAI_API_KEY is missing. Deferring construction to
// first real use (instead of at module import time, as before) lets this
// module be imported in tests/tools with no API key present, as long as
// they never actually call createEmbedding()/the default embedBatch.
let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

export async function createEmbedding(text) {
  try {
    const response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("Embedding error:", error.message);
    return null;
  }
}

/**
 * Splits `texts` into fixed-size batches, tracking each batch's starting
 * index in the original array. Pure function, exported so it can be unit
 * tested without touching OpenAI.
 */
export function splitIntoBatches(texts, batchSize) {

  if (!Array.isArray(texts)) {
    throw new Error("splitIntoBatches: texts must be an array.");
  }

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("splitIntoBatches: batchSize must be a positive integer.");
  }

  const batches = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push({
      startIndex: i,
      texts: texts.slice(i, i + batchSize),
    });
  }

  return batches;

}

async function defaultEmbedBatch(texts) {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}

/**
 * Batch embedding helper, additive to createEmbedding() (which is left
 * completely unchanged for existing callers, e.g. Memory).
 *
 * Design choices:
 * - Empty/blank strings are REJECTED (throws), not silently skipped, so
 *   the returned array's length and order always line up 1:1 with the
 *   input array. Callers (e.g. the Knowledge Chunk service) rely on this
 *   to zip chunks with embeddings by index.
 * - No retries. A failing batch throws immediately with batch context
 *   (batch number, item index range, underlying error message) — there
 *   is no retry loop, so this can never spin forever.
 * - `embedBatch` is injectable via options (defaults to a real OpenAI
 *   call) specifically so tests can exercise the real batching / order /
 *   error-handling logic without ever calling OpenAI.
 *
 * @param {string[]} texts
 * @param {{ batchSize?: number, concurrency?: number, embedBatch?: (texts: string[]) => Promise<number[][]> }} options
 * @returns {Promise<number[][]>} embeddings, same order/length as `texts`
 */
export async function createEmbeddings(texts, options = {}) {

  const {
    batchSize = DEFAULT_BATCH_SIZE,
    concurrency = DEFAULT_CONCURRENCY,
    embedBatch = defaultEmbedBatch,
  } = options;

  if (!Array.isArray(texts)) {
    throw new Error("createEmbeddings: texts must be an array of strings.");
  }

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("createEmbeddings: batchSize must be a positive integer.");
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("createEmbeddings: concurrency must be a positive integer.");
  }

  if (texts.length === 0) {
    return [];
  }

  texts.forEach((text, i) => {
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(
        `createEmbeddings: texts[${i}] is empty or not a string. ` +
        "Empty inputs are rejected rather than silently skipped, so the " +
        "result array always matches the input array 1:1."
      );
    }
  });

  const batches = splitIntoBatches(texts, batchSize);
  const results = new Array(texts.length);

  for (let i = 0; i < batches.length; i += concurrency) {

    const group = batches.slice(i, i + concurrency);

    const groupResults = await Promise.all(
      group.map((batch, offset) => runBatch(batch, i + offset, batches.length, embedBatch))
    );

    for (const { startIndex, embeddings } of groupResults) {
      embeddings.forEach((embedding, j) => {
        results[startIndex + j] = embedding;
      });
    }

  }

  return results;

}

async function runBatch(batch, batchIndex, totalBatches, embedBatch) {

  const batchNumber = batchIndex + 1;
  const lastIndex = batch.startIndex + batch.texts.length - 1;
  const range = `items ${batch.startIndex}-${lastIndex}`;

  let embeddings;

  try {
    embeddings = await embedBatch(batch.texts);
  } catch (error) {
    throw new Error(
      `createEmbeddings: batch ${batchNumber}/${totalBatches} (${range}) failed: ${error.message}`
    );
  }

  if (!Array.isArray(embeddings) || embeddings.length !== batch.texts.length) {
    const got = Array.isArray(embeddings) ? embeddings.length : typeof embeddings;
    throw new Error(
      `createEmbeddings: batch ${batchNumber}/${totalBatches} (${range}) returned ${got} ` +
      `embeddings, expected ${batch.texts.length}.`
    );
  }

  return { startIndex: batch.startIndex, embeddings };

}
