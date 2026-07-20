import { supabase } from "../../providers/storage/supabase.js";
import { createEmbedding } from "../ai/embeddingService.js";
import { normalizeMemoryFactContent } from "./memoryFilter.js";
import {
  filterMemoriesByActor,
  memoryRowHasOwnerMeta,
  normalizeTelegramActorId,
} from "./memoryActorScope.js";

export {
  filterMemoriesByActor,
  extractMemoryOwnerIds,
  memoryRowHasOwnerMeta,
  normalizeTelegramActorId,
} from "./memoryActorScope.js";
export { normalizeMemoryFactContent } from "./memoryFilter.js";

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
  const saveLabel = describeMemorySaveLog(metadata);
  const isTask = saveLabel === "Сохраняю задачу";
  // Tasks keep caller content; memory notes never persist imperative
  // "Запомни…" / "Remember…" command wrappers.
  const normalizedContent = isTask
    ? String(content ?? "").trim()
    : normalizeMemoryFactContent(content);
  if (!normalizedContent) {
    console.error(`[memory] save failed semantic=empty_content`);
    return false;
  }

  const embedding = await createEmbedding(normalizedContent);

  const semanticType = isTask
    ? "task_create"
    : metadata?.actionType || metadata?.memoryType || "memory_save";
  const contentChars = normalizedContent.length;

  // Concise metadata only — never log full message content or the vector.
  console.log(
    `[memory] action=save semantic=${semanticType} chars=${contentChars} dims=${embedding ? embedding.length : 0}`
  );

  const { error } = await supabase.from("memories").insert({
    source,
    type,
    content: normalizedContent,
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

/**
 * Strip recall command prefixes so semantic search matches saved facts.
 * @param {string} query
 * @returns {string}
 */
export function normalizeMemorySearchQuery(query) {
  const original = String(query ?? "").trim();
  if (!original) return "";

  let q = original;
  q = q
    .replace(/^(вспомни|вспомнить|remember)(?:\s*,?\s*что)?\s+/iu, "")
    .trim();
  q = q
    .replace(
      /^что\s+ты\s+знаешь\s+(?:обо?\s+мне|о\s+моих\s+предпочтениях)\??$/iu,
      ""
    )
    .trim();
  q = q.replace(/^what\s+do\s+you\s+know\s+about\s+me\??$/iu, "").trim();
  q = q
    .replace(
      /^what\s+do\s+you\s+know\s+about\s+my\s+preferences\??$/iu,
      ""
    )
    .trim();

  // About-me / preference probes with no residual topic → keep a stable
  // preference-oriented probe so embeddings can still hit saved likes.
  if (!q) {
    if (
      /обо?\s+мне|о\s+моих\s+предпочтениях|about\s+me|my\s+preferences/iu.test(
        original
      )
    ) {
      return "мои предпочтения нравится";
    }
    return original;
  }

  return q;
}

/**
 * When match_memories omits ownership metadata, load id/metadata/created_at
 * for candidate rows. Fail closed on fetch errors (filter drops unowned).
 *
 * @param {object[]} rows
 * @returns {Promise<object[]>}
 */
export async function hydrateMemoryOwnership(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const missingIds = [
    ...new Set(
      rows
        .filter((r) => r?.id && !memoryRowHasOwnerMeta(r))
        .map((r) => r.id)
    ),
  ];

  if (missingIds.length === 0) return rows;

  const { data, error } = await supabase
    .from("memories")
    .select("id, metadata, created_at, content")
    .in("id", missingIds);

  if (error || !Array.isArray(data)) {
    console.log(
      `[memory] action=hydrate ok=false missingIds=${missingIds.length}`
    );
    return rows;
  }

  const byId = new Map(data.map((r) => [r.id, r]));
  console.log(
    `[memory] action=hydrate ok=true fetched=${data.length} missingIds=${missingIds.length}`
  );

  return rows.map((row) => {
    const full = byId.get(row.id);
    if (!full) return row;
    return {
      ...row,
      metadata:
        row.metadata && typeof row.metadata === "object"
          ? row.metadata
          : full.metadata,
      created_at: row.created_at ?? full.created_at ?? null,
      content: row.content != null ? row.content : full.content,
    };
  });
}

/**
 * Actor-scoped recent memories (PostgREST JSON text paths — no embeddings).
 * @param {string} actorId
 * @param {object} [opts]
 * @returns {Promise<object[]>}
 */
export async function listMemoriesForActor(actorId, opts = {}) {
  const id = String(actorId ?? "")
    .trim()
    .replace(/^telegram:/i, "");
  if (!id) return [];

  const limit = Math.min(Math.max(Number(opts.limit) || 12, 1), 30);

  // metadata->>* is always text, so number/string JSON values both match.
  const { data, error } = await supabase
    .from("memories")
    .select("id, content, metadata, created_at, source, type")
    .or(
      [
        `metadata->>userId.eq.${id}`,
        `metadata->>user_id.eq.${id}`,
        `metadata->>chatId.eq.${id}`,
        `metadata->>chat_id.eq.${id}`,
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.log(`[memory] action=list_actor ok=false`);
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  // Defense in depth: never return unscoped rows even if the filter misfires.
  return filterMemoriesByActor(rows, { userId: id });
}

export async function searchMemories(query, options = {}) {
  const originalQuery = String(query ?? "").trim();
  const searchQuery = normalizeMemorySearchQuery(originalQuery);
  const queryChars = searchQuery.length;
  const actorId = normalizeTelegramActorId(options);

  const embedding = await createEmbedding(searchQuery);

  if (!embedding) {
    console.error("Не удалось создать embedding для поиска.");
    return [];
  }

  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: embedding,
    match_threshold: 0.3,
    match_count: 10,
  });

  // Never log RPC rows (they can include embeddings / full content).
  const rawMatchCount = Array.isArray(data) ? data.length : 0;
  console.log(
    `[memory] action=search queryChars=${queryChars} raw=${rawMatchCount} ok=${!error}`
  );

  if (error) {
    console.error("Ошибка поиска памяти:", error.message || error);
    return [];
  }

  let rows = Array.isArray(data) ? data : [];
  rows = await hydrateMemoryOwnership(rows);
  let scoped = filterMemoriesByActor(rows, options);

  // About-me / preference recall: if semantic+actor filter yields nothing,
  // use a scoped recent-list path (never unscoped return).
  if (scoped.length === 0 && actorId && isBroadMemoryRecall(originalQuery)) {
    const listed = await listMemoriesForActor(actorId, { limit: 12 });
    scoped = listed.map((r) => ({
      ...r,
      similarity: typeof r.similarity === "number" ? r.similarity : 0.78,
    }));
    console.log(
      `[memory] action=search_fallback scoped=${scoped.length} actor=1`
    );
  }

  console.log(
    `[memory] action=search_scoped raw=${rawMatchCount} scoped=${scoped.length}`
  );

  return scoped;
}

function isBroadMemoryRecall(query) {
  const q = String(query ?? "");
  return /вспомни|remember|обо?\s+мне|о\s+моих\s+предпочтениях|about\s+me|my\s+preferences|нравит|предпочит/iu.test(
    q
  );
}
