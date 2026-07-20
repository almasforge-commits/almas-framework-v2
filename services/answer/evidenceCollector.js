/**
 * Evidence collector — maps subsystem hits → EvidenceItem.
 * Never returns embeddings or raw storage rows.
 */

import { createEvidenceItem } from "./answerContracts.js";

/**
 * @param {object|null} pending - clarification pending record
 */
export function collectConversationEvidence(pending) {
  if (!pending || typeof pending !== "object") return [];
  if (pending.status && pending.status !== "pending") return [];

  const content = [
    pending.kind ? `pending:${pending.kind}` : null,
    pending.question || null,
    Array.isArray(pending.missingFields) && pending.missingFields.length
      ? `missing:${pending.missingFields.join(",")}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");

  if (!content) return [];

  return [
    createEvidenceItem({
      id: pending.id ?? `ctx_${pending.actorKey}_${pending.chatId}`,
      source: "conversation_context",
      scope: "conversation",
      confidence: 0.9,
      timestamp: pending.createdAt ?? Date.now(),
      domain: pending.kind ?? "clarification",
      factId: pending.id ?? null,
      reason: "pending_clarification",
      provenance: {
        sourceType: "conversation_context",
        provider: "clarification_engine",
        retrievedAt: Date.now(),
      },
      content,
      summary: String(pending.question ?? content).slice(0, 280),
    }),
  ];
}

/**
 * @param {object[]} hits - PK retrieval hits or facts
 */
export function collectPersonalEvidence(hits) {
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((h) => h && h.scope !== "world")
    .map((h) =>
      createEvidenceItem({
        id: h.id ?? null,
        source: "personal_knowledge",
        scope: "personal",
        confidence: h.confidence,
        timestamp: h.updatedAt ?? h.createdAt ?? Date.now(),
        domain: h.domain ?? null,
        factId: h.id ?? null,
        reason: "personal_fact",
        provenance: h.provenance ?? {
          sourceType: h.sourceType ?? "personal_knowledge",
          provider: "personal_knowledge_engine",
          retrievedAt: Date.now(),
        },
        content: h.content ?? "",
        summary: String(h.content ?? "").slice(0, 280),
      })
    )
    .filter((e) => e.content);
}

/**
 * @param {object[]} insights
 */
export function collectReasoningEvidence(insights, recommendations = []) {
  const out = [];
  if (Array.isArray(insights)) {
    for (const i of insights) {
      if (!i) continue;
      out.push(
        createEvidenceItem({
          id: i.id ?? null,
          source: "reasoning_insight",
          scope: "reasoning",
          confidence: i.confidence,
          timestamp: i.updatedAt ?? i.createdAt ?? Date.now(),
          domain: Array.isArray(i.relatedDomains)
            ? i.relatedDomains[0]
            : i.type ?? null,
          factId: i.id ?? null,
          reason: i.type ?? "insight",
          provenance: {
            sourceType: "reasoning_engine",
            provider: "reasoning_engine",
            retrievedAt: Date.now(),
          },
          content: [i.title, i.description].filter(Boolean).join(" — "),
          summary: String(i.title ?? i.description ?? "").slice(0, 280),
        })
      );
    }
  }
  if (Array.isArray(recommendations)) {
    for (const r of recommendations) {
      if (!r) continue;
      out.push(
        createEvidenceItem({
          id: r.id ?? null,
          source: "reasoning_recommendation",
          scope: "reasoning",
          confidence: r.confidence,
          timestamp: r.updatedAt ?? r.createdAt ?? Date.now(),
          domain: "recommendation",
          factId: r.id ?? null,
          reason: "recommendation",
          provenance: {
            sourceType: "reasoning_engine",
            provider: "reasoning_engine",
            retrievedAt: Date.now(),
          },
          content: [r.title, r.description].filter(Boolean).join(" — "),
          summary: String(r.title ?? r.description ?? "").slice(0, 280),
        })
      );
    }
  }
  return out.filter((e) => e.content);
}

/**
 * @param {object[]} hits - world retrieval hits / gateway results (must keep provenance)
 */
export function collectWorldEvidence(hits) {
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((h) => h && (h.scope === "world" || !h.scope))
    .map((h) => {
      const content = String(
        h.content ?? h.summary ?? h.title ?? ""
      ).trim();
      const summary = String(h.summary ?? h.title ?? content).slice(0, 280);
      const prov = h.provenance && typeof h.provenance === "object"
        ? h.provenance
        : {};
      return createEvidenceItem({
        id: h.id ?? h.url ?? null,
        source: "world_knowledge",
        scope: "world",
        confidence: h.confidence ?? prov.confidence ?? 0.4,
        timestamp:
          prov.retrievedAt ??
          h.retrievedAt ??
          h.publishedAt ??
          Date.now(),
        domain: h.domain ?? h.sourceType ?? "Knowledge",
        factId: h.id ?? h.url ?? null,
        reason: "world_hit",
        provenance: {
          sourceType:
            prov.sourceType ?? h.sourceType ?? "world_provider",
          provider: prov.provider ?? h.provider ?? "world_adapter",
          retrievedAt: prov.retrievedAt ?? h.retrievedAt ?? Date.now(),
          url: prov.url ?? h.url ?? null,
          language: prov.language ?? h.language ?? null,
          publishedAt: prov.publishedAt ?? h.publishedAt ?? null,
          confidence: prov.confidence ?? h.confidence ?? null,
        },
        content,
        summary,
      });
    })
    .filter((e) => e.content && e.provenance?.provider);
}

/**
 * Domain reader results → evidence (read-only summaries).
 * @param {string} source - finance|tasks|knowledge|memory
 * @param {Array|object} payload
 */
export function collectDomainEvidence(source, payload) {
  const items = [];
  if (payload == null) return items;

  if (source === "finance") {
    if (typeof payload === "object" && !Array.isArray(payload)) {
      // balance map
      const parts = Object.entries(payload).map(([cur, v]) => {
        const bal = v?.balance ?? v;
        return `${cur}: ${bal}`;
      });
      if (parts.length) {
        items.push(
          createEvidenceItem({
            id: "finance_balance",
            source: "finance",
            scope: "domain",
            confidence: 0.95,
            domain: "Finance",
            factId: "finance_balance",
            reason: "balance_snapshot",
            provenance: {
              sourceType: "finance_service",
              provider: "finance",
              retrievedAt: Date.now(),
            },
            content: `Balance: ${parts.join(", ")}`,
            summary: `Balance: ${parts.join(", ")}`.slice(0, 280),
          })
        );
      }
    }
    if (Array.isArray(payload)) {
      for (const t of payload.slice(0, 10)) {
        items.push(
          createEvidenceItem({
            id: t.id ?? null,
            source: "finance",
            scope: "domain",
            confidence: 0.9,
            domain: "Finance",
            factId: t.id ?? null,
            reason: "transaction",
            provenance: {
              sourceType: "finance_service",
              provider: "finance",
              retrievedAt: Date.now(),
            },
            content: String(
              t.description ?? `${t.type ?? "tx"} ${t.amount ?? ""} ${t.currency ?? ""}`
            ),
            summary: String(t.description ?? t.amount ?? "").slice(0, 280),
          })
        );
      }
    }
  }

  if (source === "tasks" && Array.isArray(payload)) {
    for (const t of payload.slice(0, 15)) {
      items.push(
        createEvidenceItem({
          id: t.id ?? null,
          source: "tasks",
          scope: "domain",
          confidence: 0.9,
          domain: "Tasks",
          factId: t.id ?? null,
          reason: "active_task",
          provenance: {
            sourceType: "task_service",
            provider: "tasks",
            retrievedAt: Date.now(),
          },
          content: String(t.content ?? t.title ?? t.text ?? ""),
          summary: String(t.content ?? t.title ?? "").slice(0, 280),
        })
      );
    }
  }

  if (source === "knowledge" && Array.isArray(payload)) {
    for (const k of payload.slice(0, 10)) {
      items.push(
        createEvidenceItem({
          id: k.id ?? null,
          source: "knowledge",
          scope: "domain",
          confidence: clamp(k.score ?? k.confidence, 0.7),
          domain: "Knowledge",
          factId: k.id ?? null,
          reason: "knowledge_hit",
          provenance: {
            sourceType: "knowledge_service",
            provider: "knowledge",
            retrievedAt: Date.now(),
          },
          content: String(k.title ?? k.content ?? k.summary ?? ""),
          summary: String(k.title ?? k.content ?? "").slice(0, 280),
        })
      );
    }
  }

  if (source === "memory" && Array.isArray(payload)) {
    for (const m of payload.slice(0, 10)) {
      items.push(
        createEvidenceItem({
          id: m.id ?? null,
          source: "memory",
          scope: "domain",
          confidence: clamp(m.similarity ?? m.confidence, 0.7),
          domain: "Memory",
          factId: m.id ?? null,
          reason: "memory_hit",
          provenance: {
            sourceType: "memory_service",
            provider: "memory",
            retrievedAt: Date.now(),
          },
          content: String(m.content ?? m.text ?? ""),
          summary: String(m.content ?? m.text ?? "").slice(0, 280),
        })
      );
    }
  }

  return items.filter((e) => e.content);
}

function clamp(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
