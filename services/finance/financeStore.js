import {
  supabase,
  getSupabaseEnvStatus,
  readSupabaseConfig,
  requireSupabaseClient,
  SUPABASE_REASON,
} from "../../providers/storage/supabase.js";

export const FINANCE_ERROR = Object.freeze({
  missing_supabase_config: "missing_supabase_config",
  missing_url: "missing_url",
  missing_key: "missing_key",
  invalid_url: "invalid_url",
  invalid_key: "invalid_key",
  malformed_env_value: "malformed_env_value",
  create_client_exception: "create_client_exception",
  invalid_actor: "invalid_actor",
  invalid_period: "invalid_period",
  table_not_found: "table_not_found",
  column_not_found: "column_not_found",
  permission_denied: "permission_denied",
  query_failed: "query_failed",
  mapper_failed: "mapper_failed",
  unexpected_error: "unexpected_error",
});

const CONFIG_REASONS = new Set([
  SUPABASE_REASON.missing_url,
  SUPABASE_REASON.missing_key,
  SUPABASE_REASON.invalid_url,
  SUPABASE_REASON.invalid_key,
  SUPABASE_REASON.malformed_env_value,
  SUPABASE_REASON.create_client_exception,
  FINANCE_ERROR.missing_supabase_config,
]);

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
  text = text.replace(/https?:\/\/\S+/gi, "[url]");
  text = text.replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]{10,}/g, "[token]");
  text = text.replace(/\bsb_(publishable|secret)_[A-Za-z0-9_]+/g, "[key]");
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

  if (CONFIG_REASONS.has(code)) {
    return code;
  }
  if (msg.includes("supabase unavailable:")) {
    for (const reason of CONFIG_REASONS) {
      if (msg.includes(reason)) return reason;
    }
    return FINANCE_ERROR.create_client_exception;
  }

  if (
    code === "42P01" ||
    (msg.includes("does not exist") && msg.includes("relation")) ||
    msg.includes("could not find the table")
  ) {
    return FINANCE_ERROR.table_not_found;
  }
  if (
    code === "42703" ||
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("could not find the") && msg.includes("column"))
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
  if (
    msg.includes("supabaseurl is required") ||
    msg.includes("supabasikey is required")
  ) {
    return FINANCE_ERROR.missing_supabase_config;
  }
  return FINANCE_ERROR.query_failed;
}

function assertConfigured() {
  const cfg = readSupabaseConfig();
  if (!cfg.ok) {
    const code = CONFIG_REASONS.has(cfg.code)
      ? cfg.code
      : FINANCE_ERROR.missing_supabase_config;
    throw new FinanceStoreError(code, `Supabase unavailable: ${code}`, {
      status: 503,
    });
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
  let client;
  try {
    client = requireSupabaseClient();
  } catch (error) {
    const code = classifySupabaseFinanceError(error);
    throw new FinanceStoreError(code, "Supabase client is unavailable", {
      details: error?.message || String(error),
    });
  }

  let query = client
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
    const code = classifySupabaseFinanceError(error);
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
 * @returns {object}
 */
export function getFinanceSupabaseStatus() {
  return getSupabaseEnvStatus();
}

/**
 * Shared client identity for wiring tests.
 */
export function getFinanceSupabaseClient() {
  return supabase;
}
