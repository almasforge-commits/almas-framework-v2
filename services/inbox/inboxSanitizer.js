// Pure Inbox sanitizer — strips secrets, vectors, oversized payloads.
// Never mutates source objects. No I/O / domain / Telegram / AI imports.

const DEFAULT_MAX_STRING = 500;
const DEFAULT_MAX_ARRAY = 40;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_KEYS = 100;

const SENSITIVE_KEY_PATTERN =
  /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|set-cookie|password|secret|bearer|openai|bot[_-]?token|telegram[_-]?file|temp(orary)?[_-]?path|file[_-]?url|prompt|system[_-]?message|reasoning|chain[_-]?of[_-]?thought|stack|stacktrace|embedding|embeddings|vector|vectors)$/i;

const VECTORISH_KEY_PATTERN = /^(embedding|embeddings|vector|vectors|query_embedding)$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeVector(value) {
  if (!Array.isArray(value) || value.length < 33) return false;
  if (!value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return false;
  }
  // Long float arrays (embeddings) — not ordinary integer lists.
  if (value.length >= 256) return true;
  return value.some((n) => !Number.isInteger(n));
}

function looksLikeSupabaseRow(value) {
  if (!isPlainObject(value)) return false;
  // Require identity + timestamp so audit objects with an embedding key
  // are still walked key-by-key (redacting only the sensitive fields).
  return "id" in value && "created_at" in value;
}

/**
 * @param {unknown} value
 * @param {object} [options]
 * @returns {unknown}
 */
export function sanitizeInboxMetadata(value, options = {}) {
  const maxString = options.maxStringLength ?? DEFAULT_MAX_STRING;
  const maxArray = options.maxArrayLength ?? DEFAULT_MAX_ARRAY;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

  function walk(node, depth) {
    if (node == null) return node;

    if (typeof node === "string") {
      if (node.length > maxString) return `${node.slice(0, maxString)}…`;
      return node;
    }

    if (typeof node === "number" || typeof node === "boolean") return node;

    if (typeof node === "function") return "[function]";

    if (node instanceof Error) {
      return {
        name: node.name,
        message:
          typeof node.message === "string" && node.message.length > maxString
            ? `${node.message.slice(0, maxString)}…`
            : node.message,
      };
    }

    if (Array.isArray(node)) {
      if (looksLikeVector(node)) return "[vector_omitted]";
      const sliced = node.slice(0, maxArray).map((item) => walk(item, depth + 1));
      if (node.length > maxArray) sliced.push(`[+${node.length - maxArray}_more]`);
      return sliced;
    }

    if (!isPlainObject(node)) return String(node);

    if (depth > maxDepth) return "[max_depth]";

    if (
      looksLikeSupabaseRow(node) &&
      (node.embedding != null || node.query_embedding != null)
    ) {
      return {
        id: node.id ?? null,
        type: node.type ?? null,
        _omitted: "row_with_embedding",
      };
    }

    const out = {};
    const keys = Object.keys(node).slice(0, maxKeys);

    for (const key of keys) {
      if (SENSITIVE_KEY_PATTERN.test(key) || VECTORISH_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
        continue;
      }

      const child = node[key];

      if (looksLikeVector(child)) {
        out[key] = "[vector_omitted]";
        continue;
      }

      out[key] = walk(child, depth + 1);
    }

    if (Object.keys(node).length > maxKeys) {
      out._truncatedKeys = Object.keys(node).length - maxKeys;
    }

    return out;
  }

  return walk(value, 0);
}

/**
 * @param {object|null|undefined} decision
 * @param {object} [options]
 * @returns {object|null}
 */
export function sanitizeRoutingDecision(decision, options = {}) {
  if (!decision || typeof decision !== "object") return null;

  const sanitized = sanitizeInboxMetadata(
    {
      mode: decision.mode ?? null,
      tier: decision.tier ?? null,
      language: decision.language ?? null,
      reasonCode: decision.reasonCode ?? null,
      needsClarification: Boolean(decision.needsClarification),
      wouldExecute: Boolean(decision.wouldExecute),
      escalated: Boolean(decision.escalated),
      skipped: Boolean(decision.skipped),
      reason: decision.reason ?? null,
      executedCount: decision.executedCount ?? 0,
      skippedCount: decision.skippedCount ?? 0,
      skippedReasons: decision.skippedReasons ?? null,
      latencyMs: decision.timings?.totalMs ?? decision.latencyMs ?? null,
      model: decision.model ?? null,
      actions: Array.isArray(decision.actions)
        ? decision.actions.map((action) => ({
            type: action?.type ?? "unknown",
            confidence:
              typeof action?.confidence === "number" ? action.confidence : null,
            requiresConfirmation: Boolean(action?.requiresConfirmation),
          }))
        : undefined,
      actionCount: Array.isArray(decision.actions)
        ? decision.actions.length
        : decision.actionCount ?? 0,
      universalExtraction: decision.universalExtraction
        ? sanitizeInboxMetadata(decision.universalExtraction, {
            maxStringLength: options.maxStringLength ?? 500,
            maxArrayLength: options.maxArrayLength ?? 40,
            maxDepth: Math.min(options.maxDepth ?? 5, 5),
            maxKeys: options.maxKeys ?? 100,
          })
        : undefined,
    },
    options
  );

  return sanitized;
}

/**
 * @param {object|null|undefined} execution
 * @param {object} [options]
 * @returns {object|null}
 */
export function sanitizeExecutionSummary(execution, options = {}) {
  if (!execution || typeof execution !== "object") return null;

  const results = Array.isArray(execution)
    ? execution
    : Array.isArray(execution.results)
      ? execution.results
      : Array.isArray(execution.execution)
        ? execution.execution
        : [];

  return sanitizeInboxMetadata(
    {
      executedCount:
        execution.executedCount ?? results.filter((r) => r?.executed === true).length,
      skippedCount:
        execution.skippedCount ?? results.filter((r) => r?.executed !== true).length,
      results: results.map((result) => ({
        type: result?.type ?? result?.action?.type ?? "unknown",
        executed: Boolean(result?.executed),
        reason: typeof result?.reason === "string" ? result.reason : null,
      })),
    },
    options
  );
}

/**
 * @param {unknown} error
 * @param {object} [options]
 * @returns {{ errorCode: string, message: string|null }}
 */
export function sanitizeInboxError(error, options = {}) {
  const maxString = options.maxStringLength ?? DEFAULT_MAX_STRING;

  if (error == null) {
    return { errorCode: "unknown_error", message: null };
  }

  if (typeof error === "string") {
    const message = error.length > maxString ? `${error.slice(0, maxString)}…` : error;
    return { errorCode: "error", message };
  }

  if (error instanceof Error) {
    const code =
      typeof error.code === "string" && error.code.trim()
        ? error.code
        : error.name || "Error";
    const message =
      typeof error.message === "string"
        ? error.message.length > maxString
          ? `${error.message.slice(0, maxString)}…`
          : error.message
        : null;
    return { errorCode: code, message };
  }

  if (typeof error === "object") {
    const code =
      typeof error.errorCode === "string"
        ? error.errorCode
        : typeof error.code === "string"
          ? error.code
          : "error";
    const rawMessage =
      typeof error.message === "string"
        ? error.message
        : typeof error.error === "string"
          ? error.error
          : null;
    const message =
      rawMessage && rawMessage.length > maxString
        ? `${rawMessage.slice(0, maxString)}…`
        : rawMessage;
    return { errorCode: code, message };
  }

  return { errorCode: "unknown_error", message: String(error).slice(0, maxString) };
}
