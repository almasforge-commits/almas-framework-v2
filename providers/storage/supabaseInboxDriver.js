import { requireSupabaseClient } from "./supabase.js";
import {
  sanitizeInboxMetadata,
  sanitizeRoutingDecision,
  sanitizeExecutionSummary,
} from "../../services/inbox/inboxSanitizer.js";
import { getInboxConfig } from "../../config/inbox.js";

const TABLE = "inbox_items";

function resolveInboxClient(deps = {}) {
  if (deps.supabase) return deps.supabase;
  return requireSupabaseClient();
}

/**
 * Maps a camelCase Inbox item to a snake_case DB row.
 * Exported for isolated mapping tests.
 */
export function toInboxRow(item = {}) {
  const config = getInboxConfig();
  const sanitizeOpts = {
    maxDepth: config.maxMetadataDepth,
    maxKeys: config.maxMetadataKeys,
  };

  return {
    id: item.id ?? undefined,
    request_key: item.requestKey,
    source_type: item.sourceType,
    actor_key: item.actor?.actorKey ?? item.actorKey,
    telegram_user_id: item.actor?.telegramUserId ?? item.telegramUserId ?? null,
    chat_id: item.actor?.chatId ?? item.chatId ?? null,
    username: item.actor?.username ?? item.username ?? null,
    first_name: item.actor?.firstName ?? item.firstName ?? null,
    last_name: item.actor?.lastName ?? item.lastName ?? null,
    original_text: item.originalText ?? "",
    normalized_text: item.normalizedText ?? "",
    language: item.language ?? "unknown",
    information_kinds: Array.isArray(item.informationKinds)
      ? item.informationKinds
      : [],
    routing_decision: item.routingDecision
      ? sanitizeRoutingDecision(item.routingDecision, sanitizeOpts)
      : null,
    execution_summary: item.executionSummary
      ? sanitizeExecutionSummary(item.executionSummary, sanitizeOpts)
      : null,
    status: item.status ?? "received",
    error_code: item.errorCode ?? null,
    metadata: sanitizeInboxMetadata(
      item.metadata && typeof item.metadata === "object" ? item.metadata : {},
      sanitizeOpts
    ),
    created_at: item.createdAt ?? undefined,
    updated_at: item.updatedAt ?? undefined,
  };
}

/**
 * Maps a snake_case DB row to a camelCase Inbox item.
 * Exported for isolated mapping tests.
 */
export function fromInboxRow(row) {
  if (!row) return null;

  return {
    id: row.id ?? null,
    requestKey: row.request_key,
    sourceType: row.source_type,
    actor: {
      actorKey: row.actor_key,
      telegramUserId: row.telegram_user_id ?? null,
      chatId: row.chat_id ?? null,
      username: row.username ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
    },
    originalText: row.original_text ?? "",
    normalizedText: row.normalized_text ?? "",
    language: row.language ?? "unknown",
    informationKinds: Array.isArray(row.information_kinds)
      ? row.information_kinds
      : [],
    routingDecision: row.routing_decision ?? null,
    executionSummary: row.execution_summary ?? null,
    status: row.status ?? "received",
    errorCode: row.error_code ?? null,
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function logDriverError(operation, error) {
  const message = error?.message || String(error);
  console.error(`[inbox-driver] ${operation} failed: ${message}`);
}

/**
 * Inserts or upserts an Inbox item by unique request_key.
 */
export async function insertInboxItem(item, deps = {}) {
  const client = resolveInboxClient(deps);
  const row = toInboxRow(item);
  delete row.id;
  delete row.created_at;
  delete row.updated_at;

  const { data, error } = await client
    .from(TABLE)
    .upsert(row, { onConflict: "request_key" })
    .select("*")
    .single();

  if (error) {
    logDriverError("insert", error);
    throw new Error(`INBOX_INSERT_FAILED: ${error.message}`);
  }

  return fromInboxRow(data);
}

/**
 * Partial update by request_key. Patch is camelCase.
 */
export async function updateInboxItemByRequestKey(requestKey, patch = {}, deps = {}) {
  const client = resolveInboxClient(deps);
  const config = getInboxConfig();
  const sanitizeOpts = {
    maxDepth: config.maxMetadataDepth,
    maxKeys: config.maxMetadataKeys,
  };

  const row = {};

  if (patch.sourceType != null) row.source_type = patch.sourceType;
  if (patch.language != null) row.language = patch.language;
  if (patch.informationKinds != null) row.information_kinds = patch.informationKinds;
  if (patch.routingDecision !== undefined) {
    row.routing_decision = patch.routingDecision
      ? sanitizeRoutingDecision(patch.routingDecision, sanitizeOpts)
      : null;
  }
  if (patch.executionSummary !== undefined) {
    row.execution_summary = patch.executionSummary
      ? sanitizeExecutionSummary(patch.executionSummary, sanitizeOpts)
      : null;
  }
  if (patch.status != null) row.status = patch.status;
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (patch.metadata != null) {
    row.metadata = sanitizeInboxMetadata(patch.metadata, sanitizeOpts);
  }
  if (patch.originalText != null) row.original_text = patch.originalText;
  if (patch.normalizedText != null) row.normalized_text = patch.normalizedText;

  row.updated_at = new Date().toISOString();

  const { data, error } = await client
    .from(TABLE)
    .update(row)
    .eq("request_key", requestKey)
    .select("*")
    .maybeSingle();

  if (error) {
    logDriverError("update", error);
    throw new Error(`INBOX_UPDATE_FAILED: ${error.message}`);
  }

  return fromInboxRow(data);
}

export async function findInboxItemByRequestKey(requestKey, deps = {}) {
  const client = resolveInboxClient(deps);

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("request_key", requestKey)
    .maybeSingle();

  if (error) {
    logDriverError("find", error);
    throw new Error(`INBOX_FIND_FAILED: ${error.message}`);
  }

  return fromInboxRow(data);
}

/**
 * @param {{ actorKey?, telegramUserId?, sourceType?, status?, informationKind?, limit?, offset? }} options
 */
export async function listInboxItems(options = {}, deps = {}) {
  const client = resolveInboxClient(deps);
  const config = getInboxConfig();
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.floor(Number(options.limit)))
    : config.listDefaultLimit;
  const offset = Number.isFinite(Number(options.offset))
    ? Math.max(0, Math.floor(Number(options.offset)))
    : 0;

  let query = client
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.actorKey) query = query.eq("actor_key", options.actorKey);
  if (options.telegramUserId != null && options.telegramUserId !== "") {
    query = query.eq("telegram_user_id", Number(options.telegramUserId));
  }
  if (options.sourceType) query = query.eq("source_type", options.sourceType);
  if (options.status) query = query.eq("status", options.status);
  if (options.informationKind) {
    query = query.contains("information_kinds", [options.informationKind]);
  }

  const { data, error } = await query;

  if (error) {
    logDriverError("list", error);
    throw new Error(`INBOX_LIST_FAILED: ${error.message}`);
  }

  return (data ?? []).map(fromInboxRow);
}
