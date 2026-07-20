import { normalizeUserText } from "../../core/utils/normalizeUserText.js";
import {
  listDomainIds,
  isKnownDomain,
} from "../../config/domainRegistry.js";

// Pure Inbox contracts — canonical enums and helpers for the audit /
// structuring layer. Information kinds come from config/domainRegistry.js.
// No Telegram/OpenAI/Supabase/domain-service imports.

export const SOURCE_TYPES = Object.freeze([
  "telegram_text",
  "telegram_voice",
  "youtube",
  "pdf",
  "image",
  "website",
  "note",
  "automation",
  "unknown",
]);

export const INBOX_STATUSES = Object.freeze([
  "received",
  "normalized",
  "analyzed",
  "executed",
  "partially_executed",
  "clarification_required",
  "failed",
  "skipped",
]);

export const INFORMATION_KINDS = Object.freeze(listDomainIds());

export function validateSourceType(value) {
  return SOURCE_TYPES.includes(value) ? value : null;
}

export function validateInboxStatus(value) {
  return INBOX_STATUSES.includes(value) ? value : null;
}

/**
 * Validates information kinds: known kinds kept in order, duplicates
 * removed. Unknown tokens become "unknown". Empty input → [].
 * Does not mutate the caller array.
 *
 * @param {unknown} values
 * @returns {string[]}
 */
export function validateInformationKinds(values) {
  if (!Array.isArray(values)) return [];

  const out = [];
  const seen = new Set();

  for (const raw of values) {
    const kind = isKnownDomain(raw) ? raw : "unknown";
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }

  return out;
}

/**
 * Builds a stable Telegram actor from msg.from + chatId.
 * actorKey is always telegram:<telegramUserId> — never username/chatId.
 *
 * @param {{ id?: number|string, username?: string|null, first_name?: string|null, last_name?: string|null }|null} from
 * @param {number|string|null} [chatId]
 * @returns {{ actorKey: string, telegramUserId: number|null, chatId: number|null, username: string|null, firstName: string|null, lastName: string|null }}
 */
export function buildActorFromTelegram(from, chatId = null) {
  const rawId = from?.id;
  const telegramUserId =
    rawId == null || rawId === ""
      ? null
      : Number.isFinite(Number(rawId))
        ? Number(rawId)
        : null;

  const actorKey =
    telegramUserId != null ? `telegram:${telegramUserId}` : "telegram:unknown";

  const parsedChat =
    chatId == null || chatId === ""
      ? null
      : Number.isFinite(Number(chatId))
        ? Number(chatId)
        : null;

  return {
    actorKey,
    telegramUserId,
    chatId: parsedChat,
    username: from?.username ?? null,
    firstName: from?.first_name ?? null,
    lastName: from?.last_name ?? null,
  };
}

/**
 * @param {object|null|undefined} decision - decideRouting()-like object
 * @returns {object|null}
 */
export function summarizeRoutingDecision(decision) {
  if (!decision || typeof decision !== "object") return null;
  if (decision.skipped) {
    return {
      skipped: true,
      reason: typeof decision.reason === "string" ? decision.reason : "skipped",
      mode: decision.mode ?? null,
    };
  }

  const actions = Array.isArray(decision.actions)
    ? decision.actions.map((action) => ({
        type: action?.type ?? "unknown",
        confidence: typeof action?.confidence === "number" ? action.confidence : null,
        requiresConfirmation: Boolean(action?.requiresConfirmation),
      }))
    : [];

  return {
    mode: decision.mode ?? null,
    tier: decision.tier ?? null,
    language: decision.language ?? null,
    reasonCode: decision.reasonCode ?? null,
    needsClarification: Boolean(decision.needsClarification),
    wouldExecute: Boolean(decision.wouldExecute),
    escalated: Boolean(decision.escalated),
    actionCount: actions.length,
    actions,
    executedCount: decision.executedCount ?? 0,
    skippedCount: decision.skippedCount ?? 0,
    skippedReasons: decision.skippedReasons ?? null,
    latencyMs: decision.timings?.totalMs ?? null,
  };
}

/**
 * @param {object|null|undefined} execution - executeActions result or decision.execution
 * @returns {object|null}
 */
export function summarizeExecutionResult(execution) {
  if (!execution || typeof execution !== "object") return null;

  const results = Array.isArray(execution)
    ? execution
    : Array.isArray(execution.results)
      ? execution.results
      : Array.isArray(execution.execution)
        ? execution.execution
        : null;

  if (!results) {
    return {
      executedCount: execution.executedCount ?? 0,
      skippedCount: execution.skippedCount ?? 0,
      results: [],
    };
  }

  return {
    executedCount:
      execution.executedCount ?? results.filter((r) => r?.executed === true).length,
    skippedCount:
      execution.skippedCount ?? results.filter((r) => r?.executed !== true).length,
    results: results.map((result) => ({
      type: result?.type ?? result?.action?.type ?? "unknown",
      executed: Boolean(result?.executed),
      reason: typeof result?.reason === "string" ? result.reason : null,
    })),
  };
}

/**
 * Creates a canonical Inbox item from raw input. Does not mutate `input`.
 *
 * @param {object} input
 * @returns {object}
 */
export function createInboxItem(input = {}) {
  const source =
    validateSourceType(input.sourceType) ??
    validateSourceType(input.source_type) ??
    "unknown";

  const actor =
    input.actor && typeof input.actor === "object"
      ? {
          actorKey: String(input.actor.actorKey ?? "telegram:unknown"),
          telegramUserId:
            input.actor.telegramUserId == null
              ? null
              : Number(input.actor.telegramUserId),
          chatId: input.actor.chatId == null ? null : Number(input.actor.chatId),
          username: input.actor.username ?? null,
          firstName: input.actor.firstName ?? null,
          lastName: input.actor.lastName ?? null,
        }
      : buildActorFromTelegram(null, null);

  const originalText = String(input.originalText ?? input.text ?? "");
  const normalizedText =
    input.normalizedText != null
      ? String(input.normalizedText)
      : normalizeUserText(originalText);

  const status = validateInboxStatus(input.status) ?? "received";

  return {
    id: input.id ?? null,
    requestKey: String(input.requestKey ?? ""),
    sourceType: source,
    actor,
    originalText,
    normalizedText,
    language: typeof input.language === "string" && input.language ? input.language : "unknown",
    informationKinds: validateInformationKinds(input.informationKinds ?? []),
    routingDecision:
      input.routingDecision === undefined ? null : input.routingDecision,
    executionSummary:
      input.executionSummary === undefined ? null : input.executionSummary,
    status,
    errorCode: input.errorCode ?? null,
    metadata:
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? { ...input.metadata }
        : {},
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
  };
}

/**
 * Normalizes / re-validates an Inbox item shape without mutating it.
 *
 * @param {object} item
 * @returns {object}
 */
export function normalizeInboxItem(item = {}) {
  return createInboxItem(item);
}
