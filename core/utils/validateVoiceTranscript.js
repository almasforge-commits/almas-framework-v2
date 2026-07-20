const CYRILLIC_LETTER_REGEX = /[а-яёА-ЯЁ]/g;
const LATIN_LETTER_REGEX = /[a-zA-Z]/g;
const ANY_LETTER_REGEX = /\p{L}/gu;
const DIGIT_REGEX = /\d/g;

// If more than this fraction of all letters belong to neither Cyrillic
// nor Latin (e.g. Georgian, Greek, CJK), the transcript is treated as an
// unrelated-language ASR artifact and rejected outright — this is what
// catches the reported Georgian-looking hallucination, regardless of any
// incidental Cyrillic/Latin letters also present.
const MAX_OTHER_SCRIPT_RATIO = 0.3;

// Among Cyrillic + Latin letters only, Cyrillic must not be a small
// minority. This lets a handful of Latin brand names, URLs, or currency
// codes sit inside an otherwise Russian sentence (e.g. "кофе в
// Starbucks") without being rejected, while still rejecting transcripts
// that are mostly/entirely a different (Latin-script) language.
const MIN_CYRILLIC_SHARE_OF_LATIN_MIX = 0.5;

/**
 * Pure validator, no external dependency. Decides whether a voice
 * transcript is plausible enough to route, without doing any Russian
 * word-to-number conversion or command-specific parsing (that is out of
 * scope here — see routeText()/russianNumberParser.js for that).
 *
 * There is no numerical confidence score available from the
 * transcription API, so this uses deterministic, script-based rules
 * instead of inventing a fake confidence number:
 *
 * 1. Empty/whitespace-only text is never plausible.
 * 2. Text with digits and no letters at all is plausible (e.g. a bare
 *    amount spoken as a number).
 * 3. Text with no letters and no digits is not plausible (garbage/silence
 *    artifact).
 * 4. If more than MAX_OTHER_SCRIPT_RATIO of all letters are neither
 *    Cyrillic nor Latin (e.g. Georgian), the transcript is rejected.
 * 5. Otherwise, Cyrillic letters must be at least
 *    MIN_CYRILLIC_SHARE_OF_LATIN_MIX of all Cyrillic+Latin letters. Short
 *    valid Russian commands/words (e.g. "баланс", "да") are 100% Cyrillic
 *    and always pass regardless of length; a sentence that is mostly
 *    Cyrillic with a few Latin words/brand names/URLs also passes; a
 *    transcript that is mostly/entirely Latin (wrong language) does not.
 *
 * Common punctuation is never counted for or against plausibility.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPlausibleRussianTranscript(text) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) return false;

  const totalLetters = trimmed.match(ANY_LETTER_REGEX) ?? [];
  const digits = trimmed.match(DIGIT_REGEX) ?? [];

  if (totalLetters.length === 0) {
    return digits.length > 0;
  }

  const cyrillicCount = (trimmed.match(CYRILLIC_LETTER_REGEX) ?? []).length;
  const latinCount = (trimmed.match(LATIN_LETTER_REGEX) ?? []).length;
  const otherScriptCount = totalLetters.length - cyrillicCount - latinCount;

  if (otherScriptCount / totalLetters.length > MAX_OTHER_SCRIPT_RATIO) {
    return false;
  }

  const cyrillicOrLatin = cyrillicCount + latinCount;

  if (cyrillicOrLatin === 0) {
    // Only non-Cyrillic/non-Latin letters, but didn't already fail the
    // ratio check above (only possible at/near the boundary) — treat as
    // implausible rather than guessing.
    return false;
  }

  return cyrillicCount / cyrillicOrLatin >= MIN_CYRILLIC_SHARE_OF_LATIN_MIX;
}
