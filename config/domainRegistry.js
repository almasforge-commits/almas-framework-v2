// ALMAS Domain Registry — single source of truth for product domains.
// Pure config: no Telegram / OpenAI / Supabase / domain-service imports.
// Action-type vocabulary for the AI router is also derived here so
// extraction kinds, Inbox information kinds, and router actions stay aligned.

/**
 * @typedef {object} DomainDefinition
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} icon
 * @property {boolean} enabled
 * @property {boolean} extractable
 * @property {boolean} executable
 * @property {boolean} supportsSearch
 * @property {boolean} supportsTimeline
 * @property {boolean} supportsAI
 * @property {string|null} futureTable
 * @property {string[]} [relatedActionTypes] - AI-router action types (not domain ids)
 */

/** @type {readonly DomainDefinition[]} */
const DOMAINS = Object.freeze([
  Object.freeze({
    id: "finance",
    title: "Finance",
    description: "Income, expenses, balances, and money analytics.",
    icon: "💰",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: null,
    relatedActionTypes: Object.freeze(["finance_expense", "finance_income"]),
  }),
  Object.freeze({
    id: "task",
    title: "Tasks",
    description: "Things to do, reminders, and due work.",
    icon: "📋",
    enabled: true,
    extractable: true,
    executable: true,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "tasks",
    relatedActionTypes: Object.freeze(["task_create"]),
  }),
  Object.freeze({
    id: "memory",
    title: "Memory",
    description: "Personal facts, preferences, and durable notes.",
    icon: "🧠",
    enabled: true,
    extractable: true,
    executable: true,
    supportsSearch: true,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: null,
    relatedActionTypes: Object.freeze(["memory_save"]),
  }),
  Object.freeze({
    id: "idea",
    title: "Ideas",
    description: "Captured ideas and creative concepts.",
    icon: "💡",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: "ideas",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "health",
    title: "Health",
    description: "Structured health metrics (weight, sleep, steps, vitals).",
    icon: "❤️",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "health_metrics",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "knowledge",
    title: "Knowledge",
    description: "Structured knowledge from videos, docs, and sources.",
    icon: "📚",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: null,
    relatedActionTypes: Object.freeze(["knowledge_query"]),
  }),
  Object.freeze({
    id: "project",
    title: "Projects",
    description: "Project updates, status, and related workstreams.",
    icon: "🚀",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "projects",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "investment",
    title: "Investments",
    description: "Investment notes, holdings context, and market-related facts.",
    icon: "📈",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "investments",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "news",
    title: "News",
    description: "News and market snippets worth remembering.",
    icon: "📰",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "news_items",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "contact",
    title: "Contacts",
    description: "People and contact details mentioned in messages.",
    icon: "👤",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: "contacts",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "decision",
    title: "Decisions",
    description: "Explicit decisions the user made or needs to track.",
    icon: "✅",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "decisions",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "goal",
    title: "Goals",
    description: "Longer-term goals and targets.",
    icon: "🎯",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "goals",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "event",
    title: "Events",
    description: "Dated events and appointments.",
    icon: "📅",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "events",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "journal",
    title: "Journal",
    description: "Personal journal / diary entries.",
    icon: "📓",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: true,
    supportsAI: true,
    futureTable: "journal_entries",
    relatedActionTypes: Object.freeze([]),
  }),
  Object.freeze({
    id: "command",
    title: "Commands",
    description: "System and destructive commands (list, delete, complete).",
    icon: "⚙️",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: false,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: null,
    relatedActionTypes: Object.freeze(["system_command"]),
  }),
  Object.freeze({
    id: "chat",
    title: "Chat",
    description: "Open conversational / Q&A turns over knowledge.",
    icon: "💬",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: false,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: null,
    relatedActionTypes: Object.freeze(["chat"]),
  }),
  Object.freeze({
    id: "search",
    title: "Search",
    description: "Search intents over memory and knowledge.",
    icon: "🔎",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: true,
    supportsTimeline: false,
    supportsAI: true,
    futureTable: null,
    relatedActionTypes: Object.freeze(["search"]),
  }),
  Object.freeze({
    id: "unknown",
    title: "Unknown",
    description: "Unclassified or ambiguous content.",
    icon: "❓",
    enabled: true,
    extractable: true,
    executable: false,
    supportsSearch: false,
    supportsTimeline: false,
    supportsAI: false,
    futureTable: null,
    relatedActionTypes: Object.freeze(["unknown"]),
  }),
]);

/** Stable AI-router action-type order (must stay closed and ordered). */
const ROUTER_ACTION_TYPE_ORDER = Object.freeze([
  "finance_expense",
  "finance_income",
  "task_create",
  "memory_save",
  "knowledge_query",
  "search",
  "chat",
  "system_command",
  "unknown",
]);

const BY_ID = Object.freeze(
  Object.fromEntries(DOMAINS.map((domain) => [domain.id, domain]))
);

const ACTION_TYPE_TO_DOMAIN = Object.freeze(
  Object.fromEntries(
    DOMAINS.flatMap((domain) =>
      (domain.relatedActionTypes || []).map((type) => [type, domain.id])
    )
  )
);

/**
 * @param {string} id
 * @returns {DomainDefinition|null}
 */
export function getDomain(id) {
  if (typeof id !== "string" || !id) return null;
  return BY_ID[id] ?? null;
}

/**
 * @returns {DomainDefinition[]}
 */
export function listDomains() {
  return DOMAINS.slice();
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isKnownDomain(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(BY_ID, id);
}

/**
 * @returns {DomainDefinition[]}
 */
export function getExtractableDomains() {
  return DOMAINS.filter((domain) => domain.extractable);
}

/**
 * @returns {DomainDefinition[]}
 */
export function getExecutableDomains() {
  return DOMAINS.filter((domain) => domain.executable);
}

/**
 * Domain ids in registry order (Inbox information kinds / extraction kinds).
 * @returns {string[]}
 */
export function listDomainIds() {
  return DOMAINS.map((domain) => domain.id);
}

/**
 * Extractable domain ids in registry order.
 * @returns {string[]}
 */
export function listExtractableDomainIds() {
  return getExtractableDomains().map((domain) => domain.id);
}

/**
 * Closed AI-router action-type list (same membership/order as historical ACTION_TYPES).
 * @returns {readonly string[]}
 */
export function listRouterActionTypes() {
  return ROUTER_ACTION_TYPE_ORDER;
}

/**
 * @param {unknown} actionType
 * @returns {boolean}
 */
export function isKnownRouterActionType(actionType) {
  return (
    typeof actionType === "string" &&
    ROUTER_ACTION_TYPE_ORDER.includes(actionType)
  );
}

/**
 * @param {string} actionType
 * @returns {string|null} domain id
 */
export function getDomainIdForActionType(actionType) {
  if (typeof actionType !== "string") return null;
  return ACTION_TYPE_TO_DOMAIN[actionType] ?? null;
}

export { DOMAINS as DOMAIN_REGISTRY };
