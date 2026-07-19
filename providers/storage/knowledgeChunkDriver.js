const TABLE = "knowledge_chunks";
const MATCH_RPC = "match_knowledge_chunks";

// This driver targets supabase/migrations/0002_add_knowledge_chunks.sql,
// which has NOT been applied to the live database yet. Every function
// here will fail (and throw, per the "never silently return []" rule
// below) until that migration is executed.
//
// `supabase.js` is imported lazily (dynamic import, inside each function)
// rather than statically at the top of this file. Its module body calls
// dotenv.config() to read .env as a side effect of import. Loading it
// lazily means simply importing this driver (or knowledgeChunkService.js,
// which imports it) never reads .env or touches Supabase unless one of
// these functions is actually called — which is what lets
// scripts/test-knowledge-chunk-service.js import the real service module
// while injecting fake deleteFn/insertFn and never touching the network.
async function getSupabase() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

function toRow(chunk = {}) {
  return {
    knowledge_id: chunk.knowledgeId,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    token_count: chunk.tokenCount ?? null,
    embedding: chunk.embedding,
  };
}

function fromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tokenCount: row.token_count ?? null,
    embedding: row.embedding ?? null,
    createdAt: row.created_at,
  };
}

export async function insertKnowledgeChunks(chunks) {

  if (!Array.isArray(chunks)) {
    throw new Error("insertKnowledgeChunks: chunks must be an array.");
  }

  if (chunks.length === 0) {
    // Not a database failure — inserting zero rows is a legitimate no-op.
    return [];
  }

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(TABLE)
    .insert(chunks.map(toRow))
    .select();

  if (error) {
    console.error("Knowledge chunk insert failed:", error);
    throw new Error(`KNOWLEDGE_CHUNKS_INSERT_FAILED: ${error.message}`);
  }

  return (data ?? []).map(fromRow);

}

export async function deleteKnowledgeChunksByKnowledgeId(knowledgeId) {

  if (!knowledgeId) {
    throw new Error("deleteKnowledgeChunksByKnowledgeId: knowledgeId is required.");
  }

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("knowledge_id", knowledgeId)
    .select("id");

  if (error) {
    console.error("Knowledge chunk delete failed:", error);
    throw new Error(`KNOWLEDGE_CHUNKS_DELETE_FAILED: ${error.message}`);
  }

  return (data ?? []).length;

}

export async function loadKnowledgeChunksByKnowledgeId(knowledgeId) {

  if (!knowledgeId) {
    throw new Error("loadKnowledgeChunksByKnowledgeId: knowledgeId is required.");
  }

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("knowledge_id", knowledgeId)
    .order("chunk_index", { ascending: true });

  if (error) {
    console.error("Knowledge chunk load failed:", error);
    throw new Error(`KNOWLEDGE_CHUNKS_LOAD_FAILED: ${error.message}`);
  }

  // `data` is only ever [] here when Supabase genuinely found zero rows
  // for this knowledge_id (error is null) — a real error always throws
  // above instead of falling through to this line.
  return (data ?? []).map(fromRow);

}

export async function matchKnowledgeChunks({ queryEmbedding, matchThreshold = 0.3, matchCount = 10 } = {}) {

  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error("matchKnowledgeChunks: queryEmbedding must be a non-empty array.");
  }

  const supabase = await getSupabase();

  const { data, error } = await supabase.rpc(MATCH_RPC, {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    console.error("Knowledge chunk match RPC failed:", error);
    throw new Error(`KNOWLEDGE_CHUNKS_MATCH_FAILED: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    knowledgeId: row.knowledge_id,
    content: row.content,
    similarity: row.similarity,
    knowledgeTitle: row.knowledge_title,
    knowledgeType: row.knowledge_type,
    knowledgeSource: row.knowledge_source,
  }));

}
