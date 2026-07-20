// Pure, deterministic Russian spoken-number-word parser. No external
// dependency, no OpenAI/Supabase/Telegram access.
//
// Scope: units, teens, tens, hundreds, thousands, and millions —
// sufficient for everyday spoken finance amounts (e.g. "сорок тысяч",
// "два миллиона пятьсот тысяч"). Explicitly OUT of scope: billions,
// word-form fractions, and general-purpose language understanding.

const UNITS = {
  "ноль": 0,
  "один": 1,
  "одна": 1,
  "два": 2,
  "две": 2,
  "три": 3,
  "четыре": 4,
  "пять": 5,
  "шесть": 6,
  "семь": 7,
  "восемь": 8,
  "девять": 9,
};

const TEENS = {
  "десять": 10,
  "одиннадцать": 11,
  "двенадцать": 12,
  "тринадцать": 13,
  "четырнадцать": 14,
  "пятнадцать": 15,
  "шестнадцать": 16,
  "семнадцать": 17,
  "восемнадцать": 18,
  "девятнадцать": 19,
};

const TENS = {
  "двадцать": 20,
  "тридцать": 30,
  "сорок": 40,
  "пятьдесят": 50,
  "шестьдесят": 60,
  "семьдесят": 70,
  "восемьдесят": 80,
  "девяносто": 90,
};

const HUNDREDS = {
  "сто": 100,
  "двести": 200,
  "триста": 300,
  "четыреста": 400,
  "пятьсот": 500,
  "шестьсот": 600,
  "семьсот": 700,
  "восемьсот": 800,
  "девятьсот": 900,
};

// "тыс"/"млн" abbreviations and "k"/"m" letter suffixes are intentionally
// NOT included here — those are already handled by the existing
// digit-suffix regex in financeParser.js (e.g. "40 тыс", "2 млн"). This
// module only understands FULLY spelled-out number words.
const SCALES = {
  "тысяча": 1_000,
  "тысячи": 1_000,
  "тысяч": 1_000,
  "миллион": 1_000_000,
  "миллиона": 1_000_000,
  "миллионов": 1_000_000,
};

const NUMBER_WORD_SET = new Set([
  ...Object.keys(UNITS),
  ...Object.keys(TEENS),
  ...Object.keys(TENS),
  ...Object.keys(HUNDREDS),
  ...Object.keys(SCALES),
]);

const TRAILING_PUNCTUATION_REGEX = /[.,!?;:]+$/;

function stripTrailingPunctuation(token) {
  return token.replace(TRAILING_PUNCTUATION_REGEX, "");
}

/**
 * Converts a phrase consisting ENTIRELY of Russian number words (and/or
 * plain digits) into a number, e.g. "сорок тысяч" -> 40000.
 *
 * Returns null if the phrase is empty, or contains any word that is not
 * a recognized number word/digit — deliberately conservative, it never
 * guesses, so ordinary non-financial words are never interpreted as
 * money.
 *
 * Supports additive combinations of units/teens/tens/hundreds with
 * тысяча/миллион scale words, e.g.:
 *   "сорок тысяч"                    -> 40000
 *   "сорок две тысячи"               -> 42000
 *   "сто двадцать тысяч"             -> 120000
 *   "один миллион"                   -> 1000000
 *   "два миллиона пятьсот тысяч"     -> 2500000
 *   "пятьсот"                        -> 500
 *
 * Out of scope: billions, fractions, general language understanding.
 *
 * @param {string} phrase
 * @returns {number|null}
 */
export function parseRussianNumberPhrase(phrase) {
  const normalized = String(phrase ?? "").trim().toLowerCase();

  if (!normalized) return null;

  const tokens = normalized
    .split(/\s+/)
    .map(stripTrailingPunctuation)
    .filter(Boolean);

  if (tokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let matchedAny = false;

  for (const token of tokens) {

    if (/^\d+$/.test(token)) {
      current += parseInt(token, 10);
      matchedAny = true;
      continue;
    }

    if (token in UNITS) {
      current += UNITS[token];
      matchedAny = true;
      continue;
    }

    if (token in TEENS) {
      current += TEENS[token];
      matchedAny = true;
      continue;
    }

    if (token in TENS) {
      current += TENS[token];
      matchedAny = true;
      continue;
    }

    if (token in HUNDREDS) {
      current += HUNDREDS[token];
      matchedAny = true;
      continue;
    }

    if (token in SCALES) {
      total += (current || 1) * SCALES[token];
      current = 0;
      matchedAny = true;
      continue;
    }

    // Any unrecognized word inside a phrase that is supposed to be
    // entirely a number => not a valid spoken number. Bail out rather
    // than guessing.
    return null;

  }

  if (!matchedAny) return null;

  return total + current;
}

/**
 * Scans `text` for the longest contiguous run of Russian number words
 * (and/or digits) and replaces it with the equivalent plain digit
 * string, leaving every other word untouched (including case and
 * spacing). If no such run is found, or the run fails to convert,
 * returns the original text unchanged.
 *
 * A run only ever consists of CONTIGUOUS tokens that are each,
 * individually, a recognized number word or a digit — so ordinary words
 * (e.g. "кофе", "если") are never mistaken for numbers, and this never
 * loops or scans more than once through the text.
 *
 * @param {string} text
 * @returns {string}
 */
export function convertSpokenNumbersToDigits(text) {
  const value = String(text ?? "");

  if (!value.trim()) return value;

  // Alternating [word, whitespace, word, whitespace, ...] so the
  // original spacing/casing of every non-matched word is preserved
  // exactly.
  const parts = value.split(/(\s+)/);

  let bestStart = -1;
  let bestEnd = -1;
  let bestLen = 0;
  let runStart = -1;

  for (let i = 0; i < parts.length; i += 2) {

    const clean = stripTrailingPunctuation(parts[i]).toLowerCase();
    const isNumberToken = /^\d+$/.test(clean) || NUMBER_WORD_SET.has(clean);

    if (isNumberToken) {
      if (runStart === -1) runStart = i;
      const runLen = (i - runStart) / 2 + 1;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
        bestEnd = i;
      }
    } else {
      runStart = -1;
    }

  }

  if (bestLen === 0) return value;

  const wordTokens = [];

  for (let i = bestStart; i <= bestEnd; i += 2) {
    wordTokens.push(stripTrailingPunctuation(parts[i]));
  }

  const numericValue = parseRussianNumberPhrase(wordTokens.join(" "));

  if (numericValue == null) return value;

  const trailingPunctuation =
    parts[bestEnd].match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? "";

  const before = parts.slice(0, bestStart).join("");
  const after = trailingPunctuation + parts.slice(bestEnd + 1).join("");

  return `${before}${numericValue}${after}`;
}
