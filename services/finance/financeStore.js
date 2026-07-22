import { supabase, getSupabaseEnvStatus, readSupabaseConfig } from "../../providers/storage/supabase.js";

export const FINANCE_ERROR = Object.freeze({
  missing_supabase_config: "missing_supabase_config",
  invalid_actor: "invalid_actor",
  invalid_period: "invalid_period",
  table_not_found: "table_not_found",
  column_not_found: "column_not_found",
  permission_denied: "permission_denied",
  query_failed: "query_failed",
  mapper_failed: "mapper_failed",
  unexpected_error: "unexpected_error",
});

export class FinanceStoreError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, details?: string }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = "FinanceStoreError";
    this.code = code;
    this.status = opts.status ?? 503;
    this.details = sanitizeFinanceErrorMessage(opts.details || message);
  }
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeFinanceErrorMessage(raw) {
  let text = String(raw || "query failed").replace(/\s+/g, " ").trim();
  // Strip URLs / key-looking material.
  text = text.replace(/https?:\/\/\S+/gi, "[url]");
  text = text.replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]{10,}/g, "[token]");
  text = text.replace(/supabase[_a-z0-9]*key\s*=\s*\S+/gi, "[key]");
  text = text.replace(/supabase[_a-z0-9]*key/gi, "[key]");
  return text.slice(0, 160) || "query failed";
}

/**
 * Map PostgREST / Supabase errors to safe categories.
 * @param {object|null|undefined} error
 * @returns {string}
 */
export function classifySupabaseFinanceError(error) {
  if (!error) return FINANCE_ERROR.unexpected_error;
  const code = String(error.code || "");
  const msg = String(error.message || error.details || "").toLowerCase();

  if (
    code === "42P01" ||
    msg.includes("does not exist") && msg.includes("relation") ||
    msg.includes("could not find the table")
  ) {
    return FINANCE_ERROR.table_not_found;
  }
  if (
    code === "42703" ||
    (msg.includes("column") && msg.includes("does not exist")) ||
    msg.includes("could not find the") && msg.includes("column")
  ) {
    return FINANCE_ERROR.column_not_found;
  }
  if (
    code === "42501" ||
    code === "PGRST301" ||
    msg.includes("permission denied") ||
    msg.includes("row-level security") ||
    msg.includes("rls")
  ) {
    return FINANCE_ERROR.permission_denied;
  }
  if (msg.includes("supabaseurl is required") || msg.includes("supabasikey is required")) {
    return FINANCE_ERROR.missing_supabase_config;
  }
  return FINANCE_ERROR.query_failed;
}

function assertConfigured() {
  const cfg = readSupabaseConfig();
  if (!cfg.ok) {
    throw new FinanceStoreError(
      FINANCE_ERROR.missing_supabase_config,
      "Supabase is not configured",
      { status: 503 }
    );
  }
}

/**
 * Actor-scoped finance ledger rows from `finance_transactions`.
 * Matches Telegram write path: user_id text, created_at timestamptz.
 *
 * @param {string} userId
 * @param {{ fromIso?: string|null, limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listFinanceTransactionsForUser(userId, opts = {}) {
  const id = String(userId || "").trim();
  if (!id || id === "undefined" || id === "null") {
    throw new FinanceStoreError(
      FINANCE_ERROR.invalid_actor,
      "Finance actor is missing",
      { status: 401 }
    );
  }

  assertConfigured();

  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  let query = supabase
    .from("finance_transactions")
    .select(
      "id, type, amount, currency, category, description, user_id, batch_id, created_at"
    )
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.fromIso) {
    query = query.gte("created_at", opts.fromIso);
  }

  let data;
  let error;
  try {
    const result = await query;
    data = result.data;
    error = result.error;
  } catch (error) {
    const code =
      error?.code === FINANCE_ERROR.missing_supabase_config
        ? FINANCE_ERROR.missing_supabase_config
        : classifySupabaseFinanceError(error);
    throw new FinanceStoreError(code, "Finance query failed", {
      details: error?.message || String(error),
    });
  }

  if (error) {
    throw new FinanceStoreError(
      classifySupabaseFinanceError(error),
      "Finance query failed",
      { details: error.message || error.details || error.hint }
    );
  }

  return Array.isArray(data) ? data : [];
}

/**
 * @returns {{ urlPresent: boolean, keyPresent: boolean, clientCreated: boolean }}
 */
export function getFinanceSupabaseStatus() {
  return getSupabaseEnvStatus();
}
