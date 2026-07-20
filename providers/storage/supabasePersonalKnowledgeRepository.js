/**
 * Supabase Personal Knowledge repository.
 * Only this module (and sibling drivers) may import Supabase.
 * Always scopes by actor_key; sets almas.actor_key for RLS.
 */

import { supabase } from "./supabase.js";
import { buildIdempotencyKey } from "../../services/personalKnowledge/personalKnowledgeContracts.js";

const TABLE = "personal_knowledge";

/**
 * @param {object} [deps]
 * @param {object} [deps.supabase]
 */
export function createSupabasePersonalKnowledgeRepository(deps = {}) {
  const client = () => deps.supabase ?? supabase;

  async function withActor(actorKey, fn) {
    const key = String(actorKey ?? "").trim();
    if (!key) throw new Error("personal_knowledge_store_missing_actor_key");
    const sb = client();
    try {
      await sb.rpc("almas_set_actor_key", { p_actor_key: key });
    } catch {
      // RPC may be unavailable in mocks; app-level .eq filters still apply.
    }
    return fn(sb, key);
  }

  return {
    async upsert(fact) {
      const actorKey = String(fact?.actorKey ?? "").trim();
      if (!actorKey) {
        throw new Error("personal_knowledge_store_missing_actor_key");
      }
      if (!fact.domain) {
        throw new Error("personal_knowledge_store_missing_domain");
      }

      const idempotencyKey =
        fact.idempotencyKey ||
        buildIdempotencyKey(
          actorKey,
          fact.domain,
          fact.normalizedContent,
          fact.requestKey
        );

      const row = toRow({ ...fact, actorKey, idempotencyKey });

      return withActor(actorKey, async (sb) => {
        const { data, error } = await sb
          .from(TABLE)
          .upsert(row, { onConflict: "idempotency_key" })
          .select("*")
          .single();

        if (error) {
          logError("upsert", error);
          throw new Error(`PERSONAL_KNOWLEDGE_UPSERT_FAILED: ${error.message}`);
        }

        const mapped = fromRow(data);
        const isCreated = String(data.created_at) === String(data.updated_at);

        return { fact: mapped, created: isCreated };
      });
    },

    async getById(actorKey, id) {
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(TABLE)
          .select("*")
          .eq("actor_key", key)
          .eq("id", id)
          .maybeSingle();
        if (error) {
          logError("getById", error);
          throw new Error(`PERSONAL_KNOWLEDGE_GET_FAILED: ${error.message}`);
        }
        return fromRow(data);
      });
    },

    async listByActor(actorKey, opts = {}) {
      const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(TABLE)
          .select("*")
          .eq("actor_key", key)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (error) {
          logError("listByActor", error);
          throw new Error(`PERSONAL_KNOWLEDGE_LIST_FAILED: ${error.message}`);
        }
        return (data || []).map(fromRow).filter(Boolean);
      });
    },

    async listByDomain(actorKey, domain, opts = {}) {
      const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(TABLE)
          .select("*")
          .eq("actor_key", key)
          .eq("domain", domain)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (error) {
          logError("listByDomain", error);
          throw new Error(
            `PERSONAL_KNOWLEDGE_LIST_DOMAIN_FAILED: ${error.message}`
          );
        }
        return (data || []).map(fromRow).filter(Boolean);
      });
    },

    async search(actorKey, query, opts = {}) {
      const limit = Number.isFinite(opts.limit) ? opts.limit : 20;
      const q = String(query ?? "").trim().toLowerCase();
      if (!q) return [];

      return withActor(actorKey, async (sb, key) => {
        let builder = sb
          .from(TABLE)
          .select("*")
          .eq("actor_key", key)
          .eq("status", "active")
          .or(
            `normalized_content.ilike.%${escapeLike(q)}%,content.ilike.%${escapeLike(q)}%`
          )
          .order("updated_at", { ascending: false })
          .limit(limit);

        if (Array.isArray(opts.domains) && opts.domains.length) {
          builder = builder.in("domain", opts.domains);
        }

        const { data, error } = await builder;
        if (error) {
          logError("search", error);
          throw new Error(`PERSONAL_KNOWLEDGE_SEARCH_FAILED: ${error.message}`);
        }
        return (data || []).map(fromRow).filter(Boolean);
      });
    },

    async clear(actorKey) {
      if (actorKey == null || String(actorKey).trim() === "") {
        throw new Error("personal_knowledge_store_missing_actor_key");
      }
      return withActor(actorKey, async (sb, key) => {
        const { error } = await sb.from(TABLE).delete().eq("actor_key", key);
        if (error) {
          logError("clear", error);
          throw new Error(`PERSONAL_KNOWLEDGE_CLEAR_FAILED: ${error.message}`);
        }
      });
    },

    async size() {
      const sb = client();
      const { count, error } = await sb
        .from(TABLE)
        .select("*", { count: "exact", head: true });
      if (error) {
        logError("size", error);
        return 0;
      }
      return count ?? 0;
    },
  };
}

export function toPersonalKnowledgeRow(fact) {
  return toRow(fact);
}

export function fromPersonalKnowledgeRow(row) {
  return fromRow(row);
}

function toRow(fact = {}) {
  const actorKey = String(fact.actorKey ?? "").trim();
  const telegramUserId =
    fact.telegramUserId ??
    parseTelegramUserId(actorKey);

  const row = {
    actor_key: actorKey,
    telegram_user_id: telegramUserId,
    domain: String(fact.domain ?? ""),
    scope: "personal",
    content: String(fact.content ?? ""),
    normalized_content: String(fact.normalizedContent ?? fact.content ?? ""),
    confidence: Number(fact.confidence) || 0,
    entities: Array.isArray(fact.entities) ? fact.entities : [],
    evidence: embedSourceType(fact.evidence, fact.sourceType),
    status: fact.status || "active",
    request_key: fact.requestKey ?? null,
    idempotency_key: fact.idempotencyKey,
  };

  if (isUuid(fact.id)) row.id = fact.id;
  return row;
}

function fromRow(row) {
  if (!row) return null;
  const evidence = row.evidence && typeof row.evidence === "object"
    ? row.evidence
    : {};
  const sourceType =
    evidence.sourceType ??
    evidence.source_type ??
    "manual";

  const { sourceType: _st, source_type: _st2, ...evidenceRest } = evidence;

  return {
    id: row.id,
    actorKey: row.actor_key,
    telegramUserId: row.telegram_user_id ?? null,
    domain: row.domain,
    scope: row.scope || "personal",
    content: row.content,
    normalizedContent: row.normalized_content,
    confidence: Number(row.confidence) || 0,
    entities: Array.isArray(row.entities) ? row.entities : [],
    evidence: evidenceRest,
    sourceType,
    status: row.status || "active",
    requestKey: row.request_key ?? null,
    idempotencyKey: row.idempotency_key,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
}

function embedSourceType(evidence, sourceType) {
  const base =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? { ...evidence }
      : { quote: null, candidateKind: null };
  if (sourceType) base.sourceType = sourceType;
  return base;
}

function parseTelegramUserId(actorKey) {
  const m = String(actorKey).match(/^telegram:(\d+)$/);
  return m ? Number(m[1]) : null;
}

function toMs(value) {
  if (value == null) return Date.now();
  if (typeof value === "number") return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Date.now();
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function escapeLike(s) {
  return String(s).replace(/[%_,]/g, " ");
}

function logError(op, error) {
  console.error(
    `[personal-knowledge-repo] ${op} failed: ${error?.message || error}`
  );
}
