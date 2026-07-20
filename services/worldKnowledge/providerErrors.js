/**
 * Controlled World Knowledge error codes — no stack traces exposed.
 */

export const WORLD_KNOWLEDGE_ERROR = Object.freeze({
  PROVIDER_TIMEOUT: "provider_timeout",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  PROVIDER_INVALID: "provider_invalid",
  PROVIDER_ERROR: "provider_error",
  GATEWAY_ERROR: "gateway_error",
});

/**
 * @param {string} code
 * @param {string} [message]
 * @param {object} [extra]
 */
export function createWorldKnowledgeError(code, message = "", extra = {}) {
  const err = new Error(String(message || code).slice(0, 200));
  err.code =
    Object.values(WORLD_KNOWLEDGE_ERROR).includes(code)
      ? code
      : WORLD_KNOWLEDGE_ERROR.GATEWAY_ERROR;
  err.provider = extra.provider ?? null;
  err.safe = true;
  return err;
}

/**
 * Sanitize error for gateway responses (no stacks).
 * @param {unknown} error
 */
export function sanitizeWorldError(error) {
  if (!error) {
    return { code: WORLD_KNOWLEDGE_ERROR.GATEWAY_ERROR, message: "unknown" };
  }
  const code =
    error.code && Object.values(WORLD_KNOWLEDGE_ERROR).includes(error.code)
      ? error.code
      : WORLD_KNOWLEDGE_ERROR.PROVIDER_ERROR;
  return {
    code,
    message: String(error.message || code).slice(0, 200),
    provider: error.provider ?? null,
  };
}
