/**
 * Shared, pure text-normalization helpers for user-provided text (typed
 * or voice-transcribed). No external dependency, deterministic, and safe
 * for Cyrillic input.
 *
 * These are used ONLY where matching/classification requires a
 * normalized form (command matching, safety checks, finance-attempt
 * detection, voice transcript validation). The application does NOT
 * globally replace text with a normalized form — the original text is
 * always preserved separately for storage, display, and argument
 * extraction (e.g. the question in "спроси ...", or a finance
 * description).
 */

// Collapses a run of 2+ IDENTICAL punctuation marks into a single one
// (e.g. "!!!" -> "!", "??" -> "?"). Only ever matches repeated identical
// characters, so a single "." or "," used as a decimal/thousands
// separator (e.g. "40000.50", "40 000,50") is never touched.
const REPEATED_PUNCTUATION_REGEX = /([.,!?;:])\1+/g;

// Trailing punctuation stripped for exact command/safety matching only.
const TRAILING_PUNCTUATION_REGEX = /[.,!?;:]+$/;

/**
 * Light normalization safe for storage/display: trims, collapses
 * whitespace, and collapses repeated punctuation. Preserves case and all
 * non-repeated punctuation/digits, so monetary amounts and decimal
 * separators are never altered.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeUserText(text) {
  const value = String(text ?? "").trim();

  if (!value) return "";

  return value
    .replace(/\s+/g, " ")
    .replace(REPEATED_PUNCTUATION_REGEX, "$1")
    .trim();
}

/**
 * Strict normalization for exact command/safety matching only: builds on
 * normalizeUserText(), additionally stripping ALL trailing punctuation
 * (".", ",", "!", "?", ":", ";") and lowercasing.
 *
 * Never use this to extract command arguments (e.g. the question text
 * after "спроси ..."/a finance description) — always read those from the
 * original text.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeCommandText(text) {
  return normalizeUserText(text)
    .replace(TRAILING_PUNCTUATION_REGEX, "")
    .trim()
    .toLowerCase();
}
