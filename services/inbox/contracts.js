// Shared, pure vocabulary for the AI Intent Analyzer / Action Planner
// pipeline. Domain membership comes from config/domainRegistry.js;
// ACTION_TYPES remain the closed router vocabulary derived from that
// registry. No Telegram/Supabase/Finance/Memory/Tasks/Knowledge service
// imports.

import {
  listRouterActionTypes,
  isKnownRouterActionType,
  getDomainIdForActionType,
} from "../../config/domainRegistry.js";

export const LANGUAGES = ["ru", "en", "kk", "mixed", "unknown"];

// Fixed, closed set — derived from the Domain Registry's relatedActionTypes
// in a stable order. Adding a new action type means updating the registry
// (and actionValidator / deterministic detector as needed).
export const ACTION_TYPES = [...listRouterActionTypes()];

// Generic, fixed payload slots. Every action uses whichever subset of
// these applies to its type (e.g. finance_expense uses amount/currency/
// description; task_create uses content; knowledge_query uses query).
// Kept as a fixed, closed set (rather than a fully dynamic object) so
// the AI provider's JSON schema can stay strict and so the validator
// can strip anything unexpected without guessing.
export const PAYLOAD_FIELDS = [
  "amount",
  "currency",
  "description",
  "content",
  "query",
  "date",
  "command",
];

// system_command action payload.command values that are destructive
// (irreversible data loss). Mirrors the same phrases already blocked
// deterministically in handlers/messageHandler.js and
// services/storage/memoryFilter.js — kept as its own small local list
// for the same reason (independent guarantee, not a cross-file
// dependency on control flow elsewhere).
export const DESTRUCTIVE_COMMAND_IDS = [
  "delete_all_knowledge",
  "delete_last_transaction",
];

export function isValidLanguage(language) {
  return LANGUAGES.includes(language);
}

export function isValidActionType(type) {
  return isKnownRouterActionType(type);
}

export { getDomainIdForActionType };

export function isDestructiveAction(action) {
  return (
    !!action &&
    action.type === "system_command" &&
    DESTRUCTIVE_COMMAND_IDS.includes(action.payload?.command)
  );
}

// Supported aliases some planner models put in task/memory payloads
// instead of the canonical `content` slot (observed: medium tier using
// `title`). Normalized at the contract boundary — never guessed when
// every alias is empty/missing.
const CONTENT_ALIASES = ["content", "title", "text"];

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Canonicalizes one action's payload. For task_create / memory_save,
 * folds supported aliases (`content` | `title` | `text`) into a single
 * `content` field. Does not invent a description when every alias is
 * empty. Other action types are returned unchanged (payload copied).
 *
 * @param {string} type
 * @param {object} payload
 * @returns {object}
 */
export function canonicalizeActionPayload(type, payload = {}) {
  const source = payload && typeof payload === "object" ? { ...payload } : {};

  if (type === "task_create" || type === "memory_save") {
    const content = firstNonEmptyString(...CONTENT_ALIASES.map((key) => source[key]));

    if (content != null) {
      source.content = content;
    }
  }

  return source;
}

/**
 * Returns a shallow-cloned routing contract whose every action payload
 * has been passed through canonicalizeActionPayload(). Safe on
 * null/malformed input (returns the input unchanged).
 *
 * @param {object|null|undefined} contract
 * @returns {object|null|undefined}
 */
export function normalizeRoutingContract(contract) {
  if (!contract || typeof contract !== "object") return contract;
  if (!Array.isArray(contract.actions)) return contract;

  return {
    ...contract,
    actions: contract.actions.map((action) => {
      if (!action || typeof action !== "object") return action;

      return {
        ...action,
        payload: canonicalizeActionPayload(action.type, action.payload),
      };
    }),
  };
}

/**
 * Builds one action object with the exact contract shape. Never invents
 * values — every field must be passed explicitly (missing amount stays
 * missing, never defaulted to 0/empty string, so validators/callers can
 * tell "not provided" apart from "provided as empty").
 */
export function createAction({
  type,
  confidence = 0,
  payload = {},
  requiresConfirmation = false,
} = {}) {
  return { type, confidence, payload, requiresConfirmation };
}

/**
 * Builds a full routing contract object with every required field
 * present, so downstream code never has to guard against missing keys.
 */
export function createRoutingContract({
  language = "unknown",
  actions = [],
  needsClarification = false,
  clarificationQuestion = null,
  shouldEscalate = false,
  reasonCode = "unspecified",
} = {}) {
  return {
    language,
    actions,
    needsClarification,
    clarificationQuestion,
    shouldEscalate,
    reasonCode,
  };
}
