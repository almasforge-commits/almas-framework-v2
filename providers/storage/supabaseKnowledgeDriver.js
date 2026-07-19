import { supabase } from "./supabase.js";

const TABLE = "knowledge";

function toRow(knowledge = {}) {
  return {
    id: knowledge.id,
    type: knowledge.type,
    title: knowledge.title,
    summary: knowledge.summary,
    key_points: knowledge.keyPoints ?? [],
    tags: knowledge.tags ?? [],
    ideas: knowledge.ideas ?? [],
    tasks: knowledge.tasks ?? [],
    raw_content: knowledge.rawContent ?? null,
    source: knowledge.source ?? {},
    fingerprint: knowledge.fingerprint ?? null,
    status: knowledge.status ?? "approved",
    created_at: knowledge.createdAt,
    updated_at: knowledge.updatedAt,
  };
}

function fromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    keyPoints: row.key_points ?? [],
    tags: row.tags ?? [],
    ideas: row.ideas ?? [],
    tasks: row.tasks ?? [],
    rawContent: row.raw_content ?? null,
    source: row.source ?? {},
    fingerprint: row.fingerprint ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertKnowledge(knowledge) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(knowledge))
    .select()
    .single();

  if (error) {
    console.error("Ошибка сохранения знания (insert):", error);
    throw new Error(`KNOWLEDGE_INSERT_FAILED: ${error.message}`);
  }

  return fromRow(data);
}

export async function updateKnowledge(id, knowledge) {
  const row = toRow(knowledge);
  delete row.id;

  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Ошибка сохранения знания (update):", error);
    throw new Error(`KNOWLEDGE_UPDATE_FAILED: ${error.message}`);
  }

  return fromRow(data);
}

export async function loadAllKnowledge() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*");

  if (error) {
    console.error("Ошибка загрузки знаний:", error);
    throw new Error(`KNOWLEDGE_LOAD_FAILED: ${error.message}`);
  }

  return (data ?? []).map(fromRow);
}

export async function deleteAllKnowledge() {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .not("id", "is", null)
    .select("id");

  if (error) {
    console.error("Ошибка удаления знаний:", error);
    throw new Error(`KNOWLEDGE_DELETE_ALL_FAILED: ${error.message}`);
  }

  return (data ?? []).length;
}
