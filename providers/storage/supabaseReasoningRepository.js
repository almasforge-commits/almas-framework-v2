/**
 * Supabase Reasoning repository (insights + recommendations).
 * Engines must not import this module — inject via DI only.
 */

import { supabase } from "./supabase.js";
import {
  buildInsightIdempotencyKey,
  normalizeInsightText,
} from "../../services/reasoning/reasoningContracts.js";

const INSIGHTS = "reasoning_insights";
const RECS = "reasoning_recommendations";

/**
 * @param {object} [deps]
 */
export function createSupabaseReasoningRepository(deps = {}) {
  const client = () => deps.supabase ?? supabase;

  async function withActor(actorKey, fn) {
    const key = String(actorKey ?? "").trim();
    if (!key) throw new Error("reasoning_store_missing_actor_key");
    const sb = client();
    try {
      await sb.rpc("almas_set_actor_key", { p_actor_key: key });
    } catch {
      // mocks / missing RPC
    }
    return fn(sb, key);
  }

  function filterRows(rows, opts = {}) {
    const limit = Number.isFinite(opts.limit) ? opts.limit : 50;
    let list = Array.isArray(rows) ? rows.slice() : [];
    if (!opts.includeInactive) {
      list = list.filter((r) => r.status === "active");
    }
    if (Number.isFinite(opts.minConfidence)) {
      list = list.filter((r) => (r.confidence || 0) >= opts.minConfidence);
    }
    if (opts.type) {
      list = list.filter((r) => r.type === opts.type);
    }
    if (opts.domain) {
      list = list.filter(
        (r) =>
          Array.isArray(r.relatedDomains) &&
          r.relatedDomains.includes(opts.domain)
      );
    }
    if (Number.isFinite(opts.since)) {
      list = list.filter((r) => (r.createdAt || 0) >= opts.since);
    }
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list.slice(0, limit);
  }

  return {
    async upsertInsight(insight) {
      const actorKey = String(insight?.actorKey ?? "").trim();
      if (!actorKey) throw new Error("reasoning_store_missing_actor_key");

      const idem =
        insight.idempotencyKey ||
        buildInsightIdempotencyKey(
          actorKey,
          insight.type,
          insight.normalizedTitle || normalizeInsightText(insight.title),
          insight.requestKey
        );

      const row = toInsightRow({ ...insight, actorKey, idempotencyKey: idem });

      return withActor(actorKey, async (sb) => {
        const { data, error } = await sb
          .from(INSIGHTS)
          .upsert(row, { onConflict: "idempotency_key" })
          .select("*")
          .single();
        if (error) {
          logError("upsertInsight", error);
          throw new Error(`REASONING_INSIGHT_UPSERT_FAILED: ${error.message}`);
        }
        const mapped = fromInsightRow(data);
        const created =
          data?.created_at && data?.updated_at
            ? String(data.created_at) === String(data.updated_at)
            : true;
        return { insight: mapped, created };
      });
    },

    async getInsight(actorKey, id) {
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(INSIGHTS)
          .select("*")
          .eq("actor_key", key)
          .eq("id", id)
          .maybeSingle();
        if (error) {
          logError("getInsight", error);
          throw new Error(`REASONING_INSIGHT_GET_FAILED: ${error.message}`);
        }
        return fromInsightRow(data);
      });
    },

    async listInsights(actorKey, opts = {}) {
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(INSIGHTS)
          .select("*")
          .eq("actor_key", key)
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) {
          logError("listInsights", error);
          throw new Error(`REASONING_INSIGHT_LIST_FAILED: ${error.message}`);
        }
        return filterRows((data || []).map(fromInsightRow).filter(Boolean), opts);
      });
    },

    async searchInsights(actorKey, query, opts = {}) {
      const q = String(query ?? "").trim().toLowerCase();
      const listed = await this.listInsights(actorKey, {
        ...opts,
        limit: opts.limit ?? 50,
        includeInactive: opts.includeInactive,
      });
      if (!q) return listed;
      return listed.filter(
        (i) =>
          String(i.title || "").toLowerCase().includes(q) ||
          String(i.description || "").toLowerCase().includes(q) ||
          String(i.type || "").toLowerCase().includes(q)
      );
    },

    async deleteInsight(actorKey, id) {
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(INSIGHTS)
          .delete()
          .eq("actor_key", key)
          .eq("id", id)
          .select("id");
        if (error) {
          logError("deleteInsight", error);
          throw new Error(`REASONING_INSIGHT_DELETE_FAILED: ${error.message}`);
        }
        return Array.isArray(data) && data.length > 0;
      });
    },

    async upsertRecommendation(rec) {
      const actorKey = String(rec?.actorKey ?? "").trim();
      if (!actorKey) throw new Error("reasoning_store_missing_actor_key");

      const idem =
        rec.idempotencyKey ||
        `hash:${actorKey}|${(rec.insightIds || []).join(",")}|${normalizeInsightText(rec.title)}`;

      const row = toRecRow({ ...rec, actorKey, idempotencyKey: idem });

      return withActor(actorKey, async (sb) => {
        const { data, error } = await sb
          .from(RECS)
          .upsert(row, { onConflict: "idempotency_key" })
          .select("*")
          .single();
        if (error) {
          logError("upsertRecommendation", error);
          throw new Error(`REASONING_REC_UPSERT_FAILED: ${error.message}`);
        }
        const mapped = fromRecRow(data);
        const created =
          data?.created_at && data?.updated_at
            ? String(data.created_at) === String(data.updated_at)
            : true;
        return { recommendation: mapped, created };
      });
    },

    async listRecommendations(actorKey, opts = {}) {
      return withActor(actorKey, async (sb, key) => {
        const { data, error } = await sb
          .from(RECS)
          .select("*")
          .eq("actor_key", key)
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) {
          logError("listRecommendations", error);
          throw new Error(`REASONING_REC_LIST_FAILED: ${error.message}`);
        }
        return filterRows((data || []).map(fromRecRow).filter(Boolean), opts);
      });
    },

    async searchRecommendations(actorKey, query, opts = {}) {
      const q = String(query ?? "").trim().toLowerCase();
      const listed = await this.listRecommendations(actorKey, opts);
      if (!q) return listed;
      return listed.filter(
        (r) =>
          String(r.title || "").toLowerCase().includes(q) ||
          String(r.description || "").toLowerCase().includes(q)
      );
    },

    async clear(actorKey) {
      if (actorKey == null || String(actorKey).trim() === "") {
        // Explicit empty clear-all is not supported against durable DB.
        throw new Error("reasoning_store_missing_actor_key");
      }
      return withActor(actorKey, async (sb, key) => {
        const delRecs = await sb.from(RECS).delete().eq("actor_key", key);
        if (delRecs.error) {
          logError("clearRecs", delRecs.error);
          throw new Error(
            `REASONING_CLEAR_FAILED: ${delRecs.error.message}`
          );
        }
        const delIns = await sb.from(INSIGHTS).delete().eq("actor_key", key);
        if (delIns.error) {
          logError("clearInsights", delIns.error);
          throw new Error(
            `REASONING_CLEAR_FAILED: ${delIns.error.message}`
          );
        }
      });
    },

    async size() {
      const sb = client();
      const insights = await sb
        .from(INSIGHTS)
        .select("*", { count: "exact", head: true });
      const recs = await sb
        .from(RECS)
        .select("*", { count: "exact", head: true });
      return {
        insights: insights.count ?? 0,
        recommendations: recs.count ?? 0,
      };
    },
  };
}

export function toReasoningInsightRow(insight) {
  return toInsightRow(insight);
}

export function fromReasoningInsightRow(row) {
  return fromInsightRow(row);
}

export function toReasoningRecommendationRow(rec) {
  return toRecRow(rec);
}

export function fromReasoningRecommendationRow(row) {
  return fromRecRow(row);
}

function toInsightRow(insight = {}) {
  const evidenceItems = Array.isArray(insight.evidence) ? insight.evidence : [];
  const packed = [
    ...evidenceItems,
    {
      _meta: true,
      description: insight.description ?? "",
      relatedFacts: insight.relatedFacts ?? [],
      relatedEntities: insight.relatedEntities ?? [],
      relatedDomains: insight.relatedDomains ?? [],
      title: insight.title ?? "",
    },
  ];

  const row = {
    actor_key: insight.actorKey,
    type: insight.type || "unknown",
    confidence: Number(insight.confidence) || 0,
    summary: String(insight.title || insight.summary || "").slice(0, 2000),
    evidence: packed,
    status: insight.status || "active",
    request_key: insight.requestKey ?? null,
    idempotency_key: insight.idempotencyKey,
  };
  if (isUuid(insight.id)) row.id = insight.id;
  return row;
}

function fromInsightRow(row) {
  if (!row) return null;
  const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : [];
  const meta = evidenceRaw.find((e) => e && e._meta) || {};
  const evidence = evidenceRaw.filter((e) => e && !e._meta);

  return {
    id: row.id,
    actorKey: row.actor_key,
    type: row.type,
    title: meta.title || row.summary || "",
    description: meta.description || "",
    confidence: Number(row.confidence) || 0,
    evidence,
    relatedFacts: meta.relatedFacts || [],
    relatedEntities: meta.relatedEntities || [],
    relatedDomains: meta.relatedDomains || [],
    status: row.status || "active",
    requestKey: row.request_key ?? null,
    idempotencyKey: row.idempotency_key,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
}

function toRecRow(rec = {}) {
  const insightIds = Array.isArray(rec.insightIds) ? rec.insightIds : [];
  const primary = insightIds.find((id) => isUuid(id)) || null;

  const row = {
    actor_key: rec.actorKey,
    insight_id: primary,
    priority: Number.isFinite(rec.priority) ? rec.priority : 0,
    confidence: Number(rec.confidence) || 0,
    summary: String(rec.title || rec.summary || "").slice(0, 2000),
    status: rec.status || "active",
    request_key: rec.requestKey ?? null,
    idempotency_key: rec.idempotencyKey,
    evidence: {
      description: rec.description ?? "",
      insightIds,
      title: rec.title ?? "",
    },
  };
  if (isUuid(rec.id)) row.id = rec.id;
  return row;
}

function fromRecRow(row) {
  if (!row) return null;
  const evidence =
    row.evidence && typeof row.evidence === "object" ? row.evidence : {};
  const insightIds = Array.isArray(evidence.insightIds)
    ? evidence.insightIds
    : row.insight_id
      ? [row.insight_id]
      : [];

  return {
    id: row.id,
    actorKey: row.actor_key,
    title: evidence.title || row.summary || "",
    description: evidence.description || "",
    insightIds,
    confidence: Number(row.confidence) || 0,
    priority: Number(row.priority) || 0,
    status: row.status || "active",
    requestKey: row.request_key ?? null,
    idempotencyKey: row.idempotency_key,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
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

function logError(op, error) {
  console.error(`[reasoning-repo] ${op} failed: ${error?.message || error}`);
}
