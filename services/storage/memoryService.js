import { supabase } from "../../providers/storage/supabase.js";
import { createEmbedding } from "../ai/embeddingService.js";

/**
 * Pure helper: chooses the semantic server-log label for a memories-table
 * write. Tasks still share the same storage table, but logs must say
 * "Сохраняю задачу" for task_create / memoryType:task, and
 * "Сохраняю память" otherwise. Exported for isolated tests.
 *
 * @param {object} [metadata]
 * @returns {"Сохраняю задачу"|"Сохраняю память"}
 */
export function describeMemorySaveLog(metadata = {}) {
  const isTask =
    metadata?.actionType === "task_create" || metadata?.memoryType === "task";
  return isTask ? "Сохраняю задачу" : "Сохраняю память";
}

export async function saveMemory({
  source = "telegram",
  type = "message",
  content,
  metadata = {},
}) {
  const embedding = await createEmbedding(content);

  const saveLabel = describeMemorySaveLog(metadata);
  const isTask = saveLabel === "Сохраняю задачу";
  const semanticType = isTask ? "task_create" : (metadata?.actionType || metadata?.memoryType || "memory_save");
  const contentChars = typeof content === "string" ? content.length : 0;

  // Concise metadata only — never log full message content or the vector.
  console.log(
    `[memory] action=save semantic=${semanticType} chars=${contentChars} dims=${embedding ? embedding.length : 0}`
  );

  const { error } = await supabase
    .from("memories")
    .insert({
      source,
      type,
      content,
      metadata,
      embedding,
    });

  if (error) {
    console.error(
      `[memory] save failed semantic=${semanticType}:`,
      error.message || error
    );
    return false;
  }

  console.log(`[memory] save ok semantic=${semanticType}`);

  return true;
}

export async function searchMemories(query) {

    const embedding = await createEmbedding(query);
  
    if (!embedding) {
  
      console.error("Не удалось создать embedding для поиска.");
  
      return [];
  
    }
  
    const { data, error } = await supabase.rpc("match_memories", {
  
      query_embedding: embedding,
  
      match_threshold: 0.30,
  
      match_count: 10,
  
    });

    // Never log RPC rows (they can include embeddings / full content).
    const matchCount = Array.isArray(data) ? data.length : 0;
    console.log(`[memory] action=search matches=${matchCount} ok=${!error}`);
  
    if (error) {
  
      console.error("Ошибка поиска памяти:", error.message || error);
  
      return [];
  
    }
  
    return data ?? [];
  
  }