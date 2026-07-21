/**
 * Ideas persistence — Supabase first-class ideas table.
 */

import { supabase } from "../../providers/storage/supabase.js";
import { createEmbedding } from "../ai/embeddingService.js";
import {
  IDEA_LIST_PAGE_SIZE,
  IDEA_RELATED_SIMILARITY,
  deriveIdeaTitle,
  normalizeIdeaCategory,
  normalizeIdeaTags,
  normalizeIdeaText,
} from "./ideaContracts.js";
import {
  extractIdeaCategoryFilter,
  extractIdeaSearchTopic,
  ideaMatchesCategoryFilter,
} from "./ideaQueryIntent.js";
import { selectRelatedIdeas } from "./ideaRelations.js";

/**
 * @param {object} input
 * @returns {Promise<object|null>} saved idea row (safe fields) or null
 */
export async function saveIdea(input = {}) {
  const originalText = String(input.originalText ?? input.content ?? "").trim();
  if (!originalText) return null;

  const normalizedText =
    String(input.normalizedText ?? "").trim() ||
    normalizeIdeaText(originalText);

  const actorKey = String(input.actorKey ?? "").trim();
  if (!actorKey) return null;

  const category = normalizeIdeaCategory(input.category);
  const confidence = clamp01(input.confidence, 0.5);
  const tags = normalizeIdeaTags(input.tags);
  const source = normalizeSource(input.source);
  const language = String(input.language || "unknown").slice(0, 16);

  let embedding = null;
  try {
    embedding = await createEmbedding(normalizedText);
  } catch {
    embedding = null;
  }

  const relatedIdeaIds = asIdArray(
    input.relatedIdeaIds ?? input.metadata?.relatedIdeaIds
  );

  const metadata = sanitizeMetadata({
    ...(input.metadata && typeof input.metadata === "object"
      ? input.metadata
      : {}),
    relatedIdeaIds,
  });

  const row = {
    actor_key: actorKey,
    telegram_user_id:
      input.telegramUserId != null ? Number(input.telegramUserId) : null,
    chat_id: input.chatId != null ? Number(input.chatId) : null,
    original_text: originalText.slice(0, 8000),
    normalized_text: normalizedText.slice(0, 8000),
    source,
    language,
    category,
    confidence,
    tags,
    embedding,
    related_project_ids: asIdArray(input.relatedProjectIds),
    related_memory_ids: asIdArray(input.relatedMemoryIds),
    metadata,
    archived: false,
  };

  const { data, error } = await supabase
    .from("ideas")
    .insert(row)
    .select(
      "id, actor_key, original_text, normalized_text, category, confidence, tags, language, source, created_at, updated_at, related_project_ids, related_memory_ids, metadata"
    )
    .single();

  if (error) {
    console.error(
      `[ideas] action=save source=${source} category=${category} chars=${normalizedText.length} tags=${tags.length} ok=false`
    );
    console.error("[ideas] save failed:", error.message || error);
    return null;
  }

  const mapped = mapIdeaRow(data);
  console.log(
    `[ideas] action=save source=${mapped.source} category=${mapped.category} chars=${normalizedText.length} tags=${tags.length} related=${mapped.relatedIdeas.length} ok=true`
  );
  return mapped;
}

/**
 * @param {string} ideaId
 * @param {string} actorKey
 * @param {string} category
 * @returns {Promise<object|null>}
 */
export async function updateIdeaCategory(ideaId, actorKey, category) {
  const id = String(ideaId ?? "").trim();
  const actor = String(actorKey ?? "").trim();
  const next = normalizeIdeaCategory(category);
  if (!id || !actor) return null;

  const { data, error } = await supabase
    .from("ideas")
    .update({ category: next })
    .eq("id", id)
    .eq("actor_key", actor)
    .select(
      "id, actor_key, original_text, normalized_text, category, confidence, tags, language, source, created_at, updated_at, related_project_ids, related_memory_ids, metadata"
    )
    .maybeSingle();

  if (error) {
    console.error(
      `[ideas] action=update_category id=${id} category=${next} rows=0 ok=false`
    );
    console.error("[ideas] update category failed:", error.message || error);
    return null;
  }
  const mapped = data ? mapIdeaRow(data) : null;
  console.log(
    `[ideas] action=update_category id=${id} category=${next} rows=${mapped ? 1 : 0} ok=${Boolean(mapped)}`
  );
  return mapped;
}

/**
 * Actor-scoped get by id.
 * @param {string} ideaId
 * @param {string} actorKey
 * @returns {Promise<object|null>}
 */
export async function getIdeaById(ideaId, actorKey) {
  const id = String(ideaId ?? "").trim();
  const actor = String(actorKey ?? "").trim();
  if (!id || !actor) return null;

  const { data, error } = await supabase
    .from("ideas")
    .select(
      "id, actor_key, original_text, normalized_text, category, confidence, tags, language, source, created_at, updated_at, related_project_ids, related_memory_ids, metadata, archived"
    )
    .eq("id", id)
    .eq("actor_key", actor)
    .eq("archived", false)
    .maybeSingle();

  if (error) {
    console.error("[ideas] getById failed:", error.message || error);
    return null;
  }
  return data ? mapIdeaRow(data) : null;
}

/**
 * 1-based index in actor's recent list (same order as formatIdeaList).
 * @param {string} actorKey
 * @param {number} index
 * @returns {Promise<{ idea: object|null, index: number, total: number }>}
 */
export async function getIdeaByListIndex(actorKey, index) {
  const actor = String(actorKey ?? "").trim();
  const idx = Number(index);
  if (!actor || !Number.isFinite(idx) || idx < 1) {
    return { idea: null, index: idx, total: 0 };
  }

  const total = await countIdeasForActor(actor);
  if (idx > total) return { idea: null, index: idx, total };

  const rows = await listIdeasForActor(actor, {
    limit: idx,
    offset: 0,
  });
  const idea = rows[idx - 1] || null;
  return { idea, index: idx, total };
}

/**
 * @param {string} actorKey
 * @returns {Promise<number>}
 */
export async function countIdeasForActor(actorKey) {
  const actor = String(actorKey ?? "").trim();
  if (!actor) return 0;

  const { count, error } = await supabase
    .from("ideas")
    .select("id", { count: "exact", head: true })
    .eq("actor_key", actor)
    .eq("archived", false);

  if (error) {
    console.error("[ideas] count failed:", error.message || error);
    return 0;
  }
  return Number(count) || 0;
}

/**
 * Find related idea ids for a new capture (actor-scoped).
 * @param {string} actorKey
 * @param {string} text
 * @param {object} [opts]
 * @returns {Promise<{ relatedIdeaIds: string[], related: object[] }>}
 */
export async function findRelatedIdeaIds(actorKey, text, opts = {}) {
  const actor = String(actorKey ?? "").trim();
  const content = String(text ?? "").trim();
  if (!actor || !content) return { relatedIdeaIds: [], related: [] };

  let candidates = [];
  try {
    candidates = await searchIdeas(content, {
      actorKey: actor,
      limit: opts.limit || 8,
      matchThreshold: opts.matchThreshold ?? 0.55,
      skipCategoryFilter: true,
    });
  } catch {
    candidates = await listIdeasForActor(actor, { limit: 30 });
  }

  return selectRelatedIdeas({
    text: content,
    candidates,
    category: opts.category,
    threshold: opts.threshold ?? IDEA_RELATED_SIMILARITY,
    limit: opts.maxRelated || 5,
  });
}

/**
 * Resolve related idea stubs (id + title) for card/API.
 * @param {string} actorKey
 * @param {string[]} relatedIds
 * @returns {Promise<object[]>}
 */
export async function resolveRelatedIdeas(actorKey, relatedIds) {
  const actor = String(actorKey ?? "").trim();
  const ids = asIdArray(relatedIds);
  if (!actor || !ids.length) return [];

  const { data, error } = await supabase
    .from("ideas")
    .select(
      "id, actor_key, original_text, normalized_text, category, confidence, tags, created_at, metadata, archived"
    )
    .eq("actor_key", actor)
    .eq("archived", false)
    .in("id", ids);

  if (error || !Array.isArray(data)) return [];

  const byId = new Map(data.map((row) => [row.id, mapIdeaRow(row)]));
  const list = await listIdeasForActor(actor, { limit: 100 });
  const indexById = new Map(list.map((idea, i) => [idea.id, i + 1]));

  return ids
    .map((id) => {
      const idea = byId.get(id);
      if (!idea) return null;
      return {
        id: idea.id,
        title: idea.title,
        category: idea.category,
        listIndex: indexById.get(id) ?? null,
        normalizedText: idea.normalizedText,
      };
    })
    .filter(Boolean);
}

/**
 * Actor-scoped semantic/list search for Answer Engine + Ideas experience.
 * @param {string} query
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
export async function searchIdeas(query, options = {}) {
  const actorKey = String(options.actorKey ?? "").trim();
  if (!actorKey) return [];

  const q = String(query ?? "").trim();
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 30);
  const categoryFilter =
    options.skipCategoryFilter === true
      ? null
      : options.category != null
        ? normalizeIdeaCategory(options.category)
        : extractIdeaCategoryFilter(q);
  const topic = extractIdeaSearchTopic(q);

  let embedding = null;
  try {
    embedding = q ? await createEmbedding(q) : null;
  } catch {
    embedding = null;
  }

  let rows = [];

  if (embedding) {
    const { data, error } = await supabase.rpc("match_ideas", {
      query_embedding: embedding,
      match_threshold: options.matchThreshold ?? 0.28,
      match_count: Math.max(limit, 12),
      filter_actor_key: actorKey,
    });
    if (!error && Array.isArray(data) && data.length) {
      rows = data.map((row) => ({
        ...mapIdeaRow(row),
        similarity: row.similarity,
      }));
    }
  }

  if (!rows.length) {
    rows = await listIdeasForActor(actorKey, {
      limit: Math.max(limit, 30),
      query: topic || (categoryFilter ? null : q),
      category: categoryFilter || undefined,
    });
  }

  if (categoryFilter) {
    rows = rows.filter((idea) =>
      ideaMatchesCategoryFilter(idea, categoryFilter, q)
    );
  }

  if (topic && topic.length >= 2) {
    const topicLower = topic.toLowerCase();
    const topicHits = rows.filter((idea) => {
      const hay =
        `${idea.normalizedText} ${idea.originalText} ${(idea.tags || []).join(" ")}`.toLowerCase();
      return (
        hay.includes(topicLower) ||
        topicLower.split(/\s+/).some((t) => t.length > 2 && hay.includes(t))
      );
    });
    // Prefer topic hits when present; keep semantic extras only if few topic hits.
    if (topicHits.length) {
      const ids = new Set(topicHits.map((r) => r.id));
      const extras = rows.filter((r) => !ids.has(r.id)).slice(0, 3);
      rows = [...topicHits, ...extras];
    }
  }

  console.log(
    `[ideas] action=search category=${categoryFilter || "any"} matches=${rows.length} ok=true`
  );
  return rows.slice(0, limit);
}

/**
 * @param {string} actorKey
 * @param {object} [opts]
 * @returns {Promise<object[]>}
 */
export async function listIdeasForActor(actorKey, opts = {}) {
  const actor = String(actorKey ?? "").trim();
  if (!actor) return [];

  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  let req = supabase
    .from("ideas")
    .select(
      "id, actor_key, original_text, normalized_text, category, confidence, tags, language, source, created_at, updated_at, related_project_ids, related_memory_ids, metadata, archived"
    )
    .eq("actor_key", actor)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.category) {
    req = req.eq("category", normalizeIdeaCategory(opts.category));
  }

  const { data, error } = await req;
  if (error) {
    console.error("[ideas] list failed:", error.message || error);
    return [];
  }

  let rows = Array.isArray(data) ? data.map(mapIdeaRow) : [];
  const q = String(opts.query ?? "")
    .trim()
    .toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      const hay =
        `${r.normalizedText} ${r.originalText} ${r.category} ${(r.tags || []).join(" ")}`.toLowerCase();
      return (
        hay.includes(q) ||
        q.split(/\s+/).some((t) => t.length > 2 && hay.includes(t))
      );
    });
  }
  return rows;
}

/**
 * List page for Telegram experience (capped display size).
 * @param {string} actorKey
 * @param {object} [opts]
 */
export async function listIdeasExperience(actorKey, opts = {}) {
  const pageSize = Math.min(
    Math.max(Number(opts.pageSize) || IDEA_LIST_PAGE_SIZE, 1),
    20
  );
  const total = await countIdeasForActor(actorKey);
  const ideas = await listIdeasForActor(actorKey, {
    limit: pageSize,
    offset: 0,
    category: opts.category,
  });
  return { ideas, total, pageSize };
}

export function mapIdeaRow(row) {
  if (!row) return null;
  const normalizedText = row.normalized_text ?? row.normalizedText ?? "";
  const originalText = row.original_text ?? row.originalText ?? "";
  const metadata =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const relatedIdeaIds = asIdArray(
    metadata.relatedIdeaIds ?? metadata.related_idea_ids ?? row.relatedIdeas
  );

  return {
    id: row.id,
    actorKey: row.actor_key ?? row.actorKey,
    title: deriveIdeaTitle(normalizedText || originalText),
    originalText,
    normalizedText,
    text: normalizedText || originalText,
    category: row.category,
    confidence: row.confidence,
    tags: Array.isArray(row.tags) ? row.tags : [],
    language: row.language,
    source: row.source,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    relatedProjectIds: Array.isArray(row.related_project_ids)
      ? row.related_project_ids
      : Array.isArray(row.relatedProjectIds)
        ? row.relatedProjectIds
        : [],
    relatedMemoryIds: Array.isArray(row.related_memory_ids)
      ? row.related_memory_ids
      : Array.isArray(row.relatedMemoryIds)
        ? row.relatedMemoryIds
        : [],
    relatedIdeas: relatedIdeaIds,
    relatedIdeaIds,
    metadata,
    archived: Boolean(row.archived),
    similarity: row.similarity,
  };
}

function clamp01(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function normalizeSource(source) {
  const s = String(source || "text").toLowerCase();
  if (s === "voice" || s === "telegram_voice") return "voice";
  if (s === "text" || s === "telegram_text") return "text";
  return "text";
}

function asIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).slice(0, 120)).filter(Boolean).slice(0, 20);
}

function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "embedding" || k === "vector") continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v == null) out[k] = null;
    else if (Array.isArray(v)) {
      out[k] = v
        .map((item) =>
          typeof item === "string" || typeof item === "number"
            ? String(item).slice(0, 120)
            : null
        )
        .filter(Boolean)
        .slice(0, 20);
    } else out[k] = String(v).slice(0, 200);
  }
  return out;
}
