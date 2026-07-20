import { normalizeUserText } from "../../core/utils/normalizeUserText.js";

/**
 * Normalizes raw input (typed or voice-transcribed) for the AI router
 * pipeline only. Never mutates/replaces the text used by the existing
 * deterministic router (routeText()) — this is a separate, additive
 * read path.
 *
 * Always preserves the original input alongside the normalized form, and
 * bounds the normalized text to `maxChars` (default from
 * AI_ROUTER_MAX_INPUT_CHARS) so a single very long message can't blow up
 * prompt size/cost.
 *
 * @param {string} rawText
 * @param {object} [options]
 * @param {number} [options.maxChars]
 * @param {"text"|"voice"} [options.inputSource]
 * @returns {{ original: string, normalized: string, truncated: boolean, inputSource: "text"|"voice" }}
 */
export function normalizeForRouting(rawText, options = {}) {
  const { maxChars = 6000, inputSource = "text" } = options;

  const original = String(rawText ?? "");
  const fullyNormalized = normalizeUserText(original);
  const truncated = fullyNormalized.length > maxChars;

  return {
    original,
    normalized: truncated ? fullyNormalized.slice(0, maxChars) : fullyNormalized,
    truncated,
    inputSource,
  };
}
