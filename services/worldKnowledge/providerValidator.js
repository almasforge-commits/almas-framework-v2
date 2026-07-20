/**
 * Provider result validation — rejects raw HTML and incomplete rows.
 */

import { WORLD_SOURCE_TYPES } from "./providerContracts.js";
import {
  WORLD_KNOWLEDGE_ERROR,
  createWorldKnowledgeError,
} from "./providerErrors.js";

const HTML_HINT = /<\/?[a-z][\s\S]*>/i;

/**
 * @param {object} result
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateProviderResult(result) {
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "missing_result" };
  }
  if (!String(result.provider || "").trim()) {
    return { ok: false, reason: "missing_provider" };
  }
  if (!String(result.title || "").trim() && !String(result.summary || "").trim()) {
    return { ok: false, reason: "missing_title_and_summary" };
  }
  if (HTML_HINT.test(String(result.summary || ""))) {
    return { ok: false, reason: "raw_html_forbidden" };
  }
  if (HTML_HINT.test(String(result.title || ""))) {
    return { ok: false, reason: "raw_html_forbidden" };
  }
  if (
    result.sourceType != null &&
    !WORLD_SOURCE_TYPES.includes(result.sourceType)
  ) {
    return { ok: false, reason: "invalid_source_type" };
  }
  return { ok: true };
}

/**
 * @param {object} provider
 */
export function validateProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw createWorldKnowledgeError(
      WORLD_KNOWLEDGE_ERROR.PROVIDER_INVALID,
      "provider_missing"
    );
  }
  if (!String(provider.id || "").trim()) {
    throw createWorldKnowledgeError(
      WORLD_KNOWLEDGE_ERROR.PROVIDER_INVALID,
      "provider_missing_id"
    );
  }
  for (const method of ["initialize", "search", "health", "shutdown"]) {
    if (typeof provider[method] !== "function") {
      throw createWorldKnowledgeError(
        WORLD_KNOWLEDGE_ERROR.PROVIDER_INVALID,
        `provider_missing_${method}`,
        { provider: provider.id }
      );
    }
  }
  return true;
}
