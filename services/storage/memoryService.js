import { supabase } from "../../providers/storage/supabase.js";
import { createEmbedding } from "../ai/embeddingService.js";

export async function saveMemory({
  source = "telegram",
  type = "message",
  content,
  metadata = {},
}) {
  const embedding = await createEmbedding(content);

  console.log("Сохраняю память:", content);
  console.log("Embedding создан:", embedding ? embedding.length : null);

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
    console.error("Ошибка сохранения памяти:", error);
    return false;
  }

  console.log("✅ Память сохранена");

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
  
    console.log("RPC data:", data);
  
    console.log("RPC error:", error);
  
    if (error) {
  
      console.error("Ошибка поиска памяти:", error);
  
      return [];
  
    }
  
    return data ?? [];
  
  }