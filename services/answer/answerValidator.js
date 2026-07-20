/**
 * Answer validator — structural checks; never invents fields.
 */

import { EXECUTION_NONE } from "./answerContracts.js";

export const ANSWER_REJECT = Object.freeze({
  MISSING_ACTOR: "missing_actor_key",
  EMPTY_QUERY: "empty_query",
  INVALID_RESULT: "invalid_result",
  EXECUTION_FORBIDDEN: "execution_forbidden",
});

/**
 * @param {object} input
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateAnswerRequest(input = {}) {
  const actorKey = String(input.actorKey ?? input.actor?.actorKey ?? "").trim();
  if (!actorKey) {
    return { ok: false, reason: ANSWER_REJECT.MISSING_ACTOR };
  }
  const query = String(input.query ?? input.text ?? "").trim();
  if (!query) {
    return { ok: false, reason: ANSWER_REJECT.EMPTY_QUERY };
  }
  return { ok: true };
}

/**
 * Ensure result contract and force execution=none.
 * @param {object} result
 */
export function validateAnswerResult(result) {
  if (!result || typeof result !== "object") {
    return {
      ok: false,
      reason: ANSWER_REJECT.INVALID_RESULT,
      result: null,
    };
  }

  if (
    result.execution &&
    result.execution.type &&
    result.execution.type !== "none"
  ) {
    return {
      ok: false,
      reason: ANSWER_REJECT.EXECUTION_FORBIDDEN,
      result: {
        ...result,
        execution: EXECUTION_NONE,
      },
    };
  }

  return {
    ok: true,
    result: {
      ...result,
      execution: EXECUTION_NONE,
    },
  };
}
