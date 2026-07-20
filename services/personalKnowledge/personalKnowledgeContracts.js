/**
 * Personal Knowledge contracts — closed personal ontology.
 * Pure data helpers. No Telegram / Supabase / domain-execution imports.
 *
 * Maps Universal Extraction / Domain Registry kinds → PK domains where
 * appropriate; does NOT replace config/domainRegistry.js.
 */

export const PERSONAL_KNOWLEDGE_DOMAINS = Object.freeze([
  "Identity",
  "Preferences",
  "Goals",
  "Projects",
  "Ideas",
  "Health",
  "Contacts",
  "Decisions",
  "Habits",
  "Knowledge",
  "Finance",
  "Tasks",
  "Timeline",
]);

/** Domains that may be persisted via ingest. Timeline is retrieval-only. */
export const WRITABLE_PERSONAL_DOMAINS = Object.freeze(
  PERSONAL_KNOWLEDGE_DOMAINS.filter((d) => d !== "Timeline")
);

export const PERSONAL_SCOPE = "personal";
export const WORLD_SCOPE = "world";

export const FACT_STATUSES = Object.freeze(["active", "rejected", "superseded"]);

export const SOURCE_TYPES = Object.freeze([
  "user_text",
  "user_voice",
  "extraction_candidate",
  "manual",
]);

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export const REJECT_REASONS = Object.freeze({
  EMPTY_INPUT: "empty_input",
  MISSING_ACTOR: "missing_actor_key",
  MENU_LABEL: "menu_label",
  DESTRUCTIVE_COMMAND: "destructive_command",
  WORLD_OR_GENERAL: "world_or_general",
  LOW_CONFIDENCE: "low_confidence",
  TIMELINE_WRITE: "timeline_write_forbidden",
  MALFORMED_EVIDENCE: "malformed_evidence",
  UNSUPPORTED_DOMAIN: "unsupported_domain",
  FINANCE_EXECUTION_PAYLOAD: "finance_execution_payload",
  NOT_GROUNDED: "not_grounded_in_user_input",
});

/**
 * Map Domain Registry / Universal Extraction kind → PK domain.
 * Unknown kinds return null (not invented).
 * @param {string} kind
 * @returns {string|null}
 */
export function mapRegistryKindToPersonalDomain(kind) {
  const k = String(kind ?? "").trim().toLowerCase();
  const map = {
    memory: "Knowledge",
    goal: "Goals",
    project: "Projects",
    idea: "Ideas",
    health: "Health",
    contact: "Contacts",
    decision: "Decisions",
    finance: "Finance",
    task: "Tasks",
    knowledge: "Knowledge",
    journal: "Knowledge",
    event: "Timeline",
  };
  return map[k] ?? null;
}

/**
 * @param {unknown} domain
 * @returns {boolean}
 */
export function isPersonalKnowledgeDomain(domain) {
  return PERSONAL_KNOWLEDGE_DOMAINS.includes(domain);
}

/**
 * @param {unknown} domain
 * @returns {boolean}
 */
export function isWritablePersonalDomain(domain) {
  return WRITABLE_PERSONAL_DOMAINS.includes(domain);
}

/**
 * Normalize content for matching / idempotency (no semantic invent).
 * @param {string} text
 */
export function normalizePersonalContent(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…,;:]+$/u, "");
}

/**
 * Stable non-crypto hash for idempotency fallback.
 * @param {string} input
 */
export function stableContentHash(input) {
  const s = String(input ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pkh_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * @param {string} actorKey
 * @param {string} domain
 * @param {string} normalizedContent
 * @param {string|null} [requestKey]
 */
export function buildIdempotencyKey(
  actorKey,
  domain,
  normalizedContent,
  requestKey = null
) {
  if (typeof requestKey === "string" && requestKey.trim()) {
    return `req:${requestKey.trim()}`;
  }
  return `hash:${stableContentHash(
    `${actorKey}|${domain}|${normalizedContent}`
  )}`;
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createPersonalFact(input = {}) {
  const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const content = String(input.content ?? "").trim();
  const normalizedContent =
    typeof input.normalizedContent === "string" && input.normalizedContent
      ? input.normalizedContent
      : normalizePersonalContent(content);
  const domain = input.domain;
  const actorKey = String(input.actorKey || "");
  const idempotencyKey = buildIdempotencyKey(
    actorKey,
    domain,
    normalizedContent,
    input.requestKey ?? null
  );

  return {
    id:
      input.id ??
      `pkf_${idempotencyKey.replace(/[^a-z0-9_]/gi, "_").slice(0, 48)}`,
    actorKey,
    domain,
    content,
    normalizedContent,
    confidence: clampConfidence(input.confidence),
    evidence: normalizeEvidence(input.evidence),
    sourceType: SOURCE_TYPES.includes(input.sourceType)
      ? input.sourceType
      : "user_text",
    entities: Array.isArray(input.entities)
      ? input.entities.map(sanitizeEntity).filter(Boolean)
      : [],
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
    status: FACT_STATUSES.includes(input.status) ? input.status : "active",
    requestKey:
      typeof input.requestKey === "string" && input.requestKey.trim()
        ? input.requestKey.trim()
        : null,
    idempotencyKey,
    scope: PERSONAL_SCOPE,
  };
}

/**
 * Retrieval hit with provenance.
 * @param {object} input
 */
export function createRetrievalHit(input = {}) {
  return {
    id: input.id ?? null,
    actorKey: input.actorKey ?? null,
    domain: input.domain ?? null,
    content: typeof input.content === "string" ? input.content : "",
    confidence: clampConfidence(input.confidence),
    scope: input.scope === WORLD_SCOPE ? WORLD_SCOPE : PERSONAL_SCOPE,
    provenance: {
      sourceType: input.provenance?.sourceType ?? input.sourceType ?? "unknown",
      evidence: normalizeEvidence(input.provenance?.evidence ?? input.evidence),
      provider: input.provenance?.provider ?? null,
      retrievedAt: input.provenance?.retrievedAt ?? Date.now(),
    },
  };
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeEvidence(evidence) {
  if (evidence == null) return { quote: null, candidateKind: null };
  if (typeof evidence !== "object") return null;
  const out = {
    quote:
      typeof evidence.quote === "string" ? evidence.quote.slice(0, 500) : null,
    candidateKind:
      typeof evidence.candidateKind === "string"
        ? evidence.candidateKind
        : null,
  };
  if (typeof evidence.inboxRequestKey === "string" && evidence.inboxRequestKey) {
    out.inboxRequestKey = evidence.inboxRequestKey.slice(0, 200);
  }
  if (Number.isInteger(evidence.extractionItemIndex)) {
    out.extractionItemIndex = evidence.extractionItemIndex;
  }
  if (typeof evidence.sourceType === "string" && evidence.sourceType) {
    out.sourceType = evidence.sourceType.slice(0, 64);
  }
  return out;
}

function sanitizeEntity(entity) {
  if (entity == null) return null;
  if (typeof entity === "string") {
    const t = entity.trim();
    return t ? { type: "unknown", value: t } : null;
  }
  if (typeof entity !== "object") return null;
  const value = String(entity.value ?? entity.name ?? "").trim();
  if (!value) return null;
  return {
    type: String(entity.type ?? "unknown").slice(0, 64),
    value: value.slice(0, 200),
  };
}
