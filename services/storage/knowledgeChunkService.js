import { chunkText } from "../../core/utils/chunkText.js";
import { createEmbeddings } from "../ai/embeddingService.js";
import {
  insertKnowledgeChunks,
  deleteKnowledgeChunksByKnowledgeId,
  loadKnowledgeChunksByKnowledgeId,
  matchKnowledgeChunks,
} from "../../providers/storage/knowledgeChunkDriver.js";

// NOT wired into the YouTube pipeline, Telegram handlers, or chatService
// yet. This module is a standalone foundation: chunk raw content, embed
// it, and persist/query knowledge_chunks. Depends on migration 0002,
// which has not been applied to the live database yet.

/**
 * Builds chunk rows (with embeddings) for one Knowledge item, entirely in
 * memory. Does not touch the database.
 *
 * @param {string} knowledgeId
 * @param {string} rawContent
 * @param {{ chunkOptions?: object, embedOptions?: object, createEmbeddingsFn?: Function }} options
 * @returns {Promise<Array<{ knowledgeId: string, chunkIndex: number, content: string, tokenCount: number, embedding: number[] }>>}
 */
export async function prepareKnowledgeChunkRows(knowledgeId, rawContent, options = {}) {

  if (typeof knowledgeId !== "string" || knowledgeId.trim() === "") {
    throw new Error("prepareKnowledgeChunkRows: knowledgeId is required and must be a non-empty string.");
  }

  if (typeof rawContent !== "string" || rawContent.trim() === "") {
    throw new Error("prepareKnowledgeChunkRows: rawContent is required and must be non-empty text.");
  }

  const {
    chunkOptions,
    embedOptions,
    createEmbeddingsFn = createEmbeddings,
  } = options;

  const chunks = chunkText(rawContent, chunkOptions);

  if (chunks.length === 0) {
    return [];
  }

  const embeddings = await createEmbeddingsFn(
    chunks.map((chunk) => chunk.content),
    embedOptions
  );

  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
    const got = Array.isArray(embeddings) ? embeddings.length : typeof embeddings;
    throw new Error(
      `prepareKnowledgeChunkRows: embedding count (${got}) does not match chunk count ` +
      `(${chunks.length}); refusing to build mismatched rows.`
    );
  }

  // chunks[] and embeddings[] are guaranteed to share order/length here:
  // chunkText() returns chunks in order, and createEmbeddings() preserves
  // input order 1:1 (see services/ai/embeddingService.js).
  return chunks.map((chunk, i) => ({
    knowledgeId,
    chunkIndex: chunk.index,
    content: chunk.content,
    tokenCount: chunk.tokenCount,
    embedding: embeddings[i],
  }));

}

/**
 * Replaces all stored chunks for one Knowledge item with freshly built
 * ones (chunk + embed + delete old + insert new).
 *
 * Safety ordering: chunking and embedding happen FIRST, fully in memory.
 * Old chunks are only deleted once the new rows exist in memory and are
 * ready to insert — so a chunking or embedding failure never touches
 * existing stored chunks.
 *
 * UNRESOLVED RISK (documented, not solved here): there is no database
 * transaction wrapping delete-then-insert in this codebase yet. If the
 * process crashes, loses connectivity, or the insert call fails right
 * after the delete call has already succeeded, `knowledge_chunks` will
 * be left empty for this knowledgeId until this function is called
 * again (e.g. on the next re-save of the same Knowledge item). This is a
 * real, currently-accepted gap — deliberately not papered over with a
 * fake in-app transaction. A real fix would need either a single
 * Postgres function performing delete+insert atomically, or a
 * soft-delete/versioning scheme; both are out of scope for this
 * milestone.
 *
 * @param {string} knowledgeId
 * @param {string} rawContent
 * @param {{ chunkOptions?: object, embedOptions?: object, createEmbeddingsFn?: Function, deleteFn?: Function, insertFn?: Function }} options
 */
export async function replaceKnowledgeChunks(knowledgeId, rawContent, options = {}) {

  const {
    chunkOptions,
    embedOptions,
    createEmbeddingsFn,
    deleteFn = deleteKnowledgeChunksByKnowledgeId,
    insertFn = insertKnowledgeChunks,
  } = options;

  // Step 1: build everything in memory first. If this throws, nothing in
  // the database has been touched yet.
  const rows = await prepareKnowledgeChunkRows(knowledgeId, rawContent, {
    chunkOptions,
    embedOptions,
    createEmbeddingsFn,
  });

  // Step 2: only now do we touch the database. From here on, a failure
  // leaves the gap described in the "UNRESOLVED RISK" note above.
  const deletedCount = await deleteFn(knowledgeId);

  if (rows.length === 0) {
    return { deletedCount, inserted: [] };
  }

  const inserted = await insertFn(rows);

  return { deletedCount, inserted };

}

/**
 * Convenience wrapper for callers that already have a full Knowledge
 * object (e.g. the YouTube route, right after saveKnowledge()). Keeps
 * the "nothing to chunk yet" decision in the service layer rather than
 * duplicating a rawContent check in every caller.
 *
 * @param {{ id: string, rawContent?: string|null }} knowledge
 * @param {object} options - forwarded to replaceKnowledgeChunks
 */
export async function rebuildKnowledgeChunksFromKnowledge(knowledge, options = {}) {

  if (!knowledge?.rawContent) {
    return { skipped: true, reason: "no rawContent" };
  }

  return replaceKnowledgeChunks(knowledge.id, knowledge.rawContent, options);

}

export async function getKnowledgeChunks(knowledgeId) {

  if (typeof knowledgeId !== "string" || knowledgeId.trim() === "") {
    throw new Error("getKnowledgeChunks: knowledgeId is required and must be a non-empty string.");
  }

  return loadKnowledgeChunksByKnowledgeId(knowledgeId);

}

/**
 * Semantic search over knowledge_chunks. Thin pass-through to the
 * provider's RPC call — kept here so callers depend on the service layer,
 * not the driver, consistent with the rest of this codebase.
 */
export async function searchKnowledgeChunks(queryEmbedding, options = {}) {

  return matchKnowledgeChunks({
    queryEmbedding,
    matchThreshold: options.matchThreshold,
    matchCount: options.matchCount,
  });

}
