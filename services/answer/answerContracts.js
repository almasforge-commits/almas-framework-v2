/**
 * Answer Engine contracts — structured evidence and answer objects.
 * No Telegram, no execution, no LLM.
 */

export const EVIDENCE_SCOPES = Object.freeze([
  "conversation",
  "personal",
  "reasoning",
  "world",
  "domain",
]);

export const EVIDENCE_SOURCES = Object.freeze([
  "conversation_context",
  "personal_knowledge",
  "reasoning_insight",
  "reasoning_recommendation",
  "world_knowledge",
  "finance",
  "tasks",
  "knowledge",
  "memory",
  "ideas",
]);

export const EXECUTION_NONE = Object.freeze({
  type: "none",
  actions: [],
});

/** Source trust weights for ranking / confidence (deterministic). */
export const SOURCE_TRUST = Object.freeze({
  conversation_context: 0.7,
  personal_knowledge: 1.0,
  reasoning_insight: 0.85,
  reasoning_recommendation: 0.75,
  finance: 0.95,
  tasks: 0.95,
  knowledge: 0.8,
  memory: 0.8,
  ideas: 0.85,
  world_knowledge: 0.4,
});

/** Conflict resolution priority (lower = stronger). */
export const SCOPE_PRIORITY = Object.freeze({
  personal: 0,
  domain: 1,
  reasoning: 2,
  conversation: 3,
  world: 4,
});

/**
 * @param {string} text
 */
export function normalizeAnswerText(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…,;:]+$/u, "");
}

/**
 * Evidence item — never raw storage rows / embeddings / vectors.
 * @param {object} input
 */
export function createEvidenceItem(input = {}) {
  const source = String(input.source ?? "").trim() || "unknown";
  const scope = EVIDENCE_SCOPES.includes(input.scope)
    ? input.scope
    : mapSourceToScope(source);

  const confidence = clamp01(input.confidence);
  const timestamp =
    typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
      ? input.timestamp
      : Date.now();

  const content = String(input.content ?? "").trim().slice(0, 2000);
  const summary = String(input.summary ?? content).trim().slice(0, 280);

  return {
    id: String(input.id ?? "").trim() || null,
    source,
    scope,
    confidence,
    timestamp,
    domain: input.domain != null ? String(input.domain).slice(0, 64) : null,
    factId:
      input.factId != null && String(input.factId).trim()
        ? String(input.factId).trim()
        : null,
    reason: input.reason != null ? String(input.reason).slice(0, 200) : null,
    provenance: sanitizeProvenance(input.provenance),
    content,
    summary,
    score: typeof input.score === "number" ? input.score : null,
    conflict: Boolean(input.conflict),
    conflictGroup:
      input.conflictGroup != null ? String(input.conflictGroup) : null,
  };
}

/**
 * @param {object} input
 */
export function createAnswerResult(input = {}) {
  const sources = Array.isArray(input.sources)
    ? input.sources.map(sanitizeSource).filter(Boolean).slice(0, 32)
    : [];

  return {
    answer: input.answer == null ? null : String(input.answer).slice(0, 4000),
    confidence: clamp01(input.confidence),
    needsClarification: Boolean(input.needsClarification),
    clarificationQuestion:
      input.clarificationQuestion == null
        ? null
        : String(input.clarificationQuestion).slice(0, 500),
    missingFields: Array.isArray(input.missingFields)
      ? input.missingFields.map(String).slice(0, 16)
      : [],
    sources,
    evidenceSummary: sanitizeEvidenceSummary(input.evidenceSummary),
    usedDomains: uniqueStrings(input.usedDomains),
    intent:
      input.intent != null ? String(input.intent).slice(0, 64) : "general",
    usedReasoning: Boolean(input.usedReasoning),
    usedPersonalKnowledge: Boolean(input.usedPersonalKnowledge),
    usedWorldKnowledge: Boolean(input.usedWorldKnowledge),
    usedConversationContext: Boolean(input.usedConversationContext),
    worldSources: Array.isArray(input.worldSources)
      ? input.worldSources.slice(0, 20)
      : [],
    conflicts: Array.isArray(input.conflicts)
      ? input.conflicts.slice(0, 20)
      : [],
    execution: EXECUTION_NONE,
  };
}

/**
 * Retrieval plan — which subsystems participate.
 * @param {object} input
 */
export function createRetrievalPlan(input = {}) {
  return {
    query: String(input.query ?? "").trim(),
    actorKey: String(input.actorKey ?? "").trim() || null,
    chatId: input.chatId != null ? String(input.chatId) : null,
    intent: String(input.intent ?? "general").slice(0, 64),
    includeConversation: input.includeConversation !== false,
    includePersonal: input.includePersonal !== false,
    includeReasoning: input.includeReasoning !== false,
    includeWorld: input.includeWorld !== false,
    includeDomains: input.includeDomains !== false,
    domains: uniqueStrings(input.domains),
    worldRetrievalReason:
      input.worldRetrievalReason != null
        ? String(input.worldRetrievalReason).slice(0, 64)
        : null,
  };
}

function mapSourceToScope(source) {
  if (source === "conversation_context") return "conversation";
  if (source === "personal_knowledge") return "personal";
  if (source === "reasoning_insight" || source === "reasoning_recommendation") {
    return "reasoning";
  }
  if (source === "world_knowledge") return "world";
  return "domain";
}

function sanitizeProvenance(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      sourceType: null,
      provider: null,
      retrievedAt: null,
      url: null,
      language: null,
      publishedAt: null,
      confidence: null,
    };
  }
  return {
    sourceType:
      raw.sourceType != null ? String(raw.sourceType).slice(0, 64) : null,
    provider: raw.provider != null ? String(raw.provider).slice(0, 64) : null,
    retrievedAt:
      typeof raw.retrievedAt === "number" ? raw.retrievedAt : null,
    url: raw.url != null ? String(raw.url).slice(0, 2000) : null,
    language: raw.language != null ? String(raw.language).slice(0, 16) : null,
    publishedAt:
      typeof raw.publishedAt === "number" ? raw.publishedAt : null,
    confidence:
      typeof raw.confidence === "number" ? raw.confidence : null,
  };
}

function sanitizeSource(s) {
  if (!s || typeof s !== "object") return null;
  return {
    source: String(s.source ?? "").slice(0, 64),
    scope: String(s.scope ?? "").slice(0, 32),
    domain: s.domain != null ? String(s.domain).slice(0, 64) : null,
    confidence: clamp01(s.confidence),
    factId: s.factId != null ? String(s.factId).slice(0, 128) : null,
  };
}

function sanitizeEvidenceSummary(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      total: 0,
      byScope: {},
      topIds: [],
      conflictCount: 0,
    };
  }
  const byScope = {};
  if (raw.byScope && typeof raw.byScope === "object") {
    for (const [k, v] of Object.entries(raw.byScope)) {
      byScope[String(k).slice(0, 32)] = Math.max(0, Math.floor(Number(v) || 0));
    }
  }
  return {
    total: Math.max(0, Math.floor(Number(raw.total) || 0)),
    byScope,
    topIds: Array.isArray(raw.topIds)
      ? raw.topIds.map(String).slice(0, 20)
      : [],
    conflictCount: Math.max(0, Math.floor(Number(raw.conflictCount) || 0)),
  };
}

function uniqueStrings(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(String).filter(Boolean))].slice(0, 32);
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return Math.round(x * 1000) / 1000;
}
