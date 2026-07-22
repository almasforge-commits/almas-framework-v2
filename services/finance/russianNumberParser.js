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

// "тыс"/"млн" abbreviations and "k"/"m"/"к" letter suffixes are handled by
// financeParser.js digit-suffix regex. This module only understands FULLY
// spelled-out number words.
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

    return null;
  }

  if (!matchedAny) return null;

  return total + current;
}

function isNumberToken(raw) {
  const clean = stripTrailingPunctuation(String(raw ?? "")).toLowerCase();
  if (!clean) return false;
  return /^\d+$/.test(clean) || NUMBER_WORD_SET.has(clean);
}

/**
 * Tokenize into words / whitespace / punctuation so commas break runs:
 * "75 тысяч, 25 тысяч" → two independent amounts, not 100000.
 */
function tokenizeForSpokenConversion(value) {
  return String(value ?? "").split(/(\s+|[.,!?;:]+)/);
}

/**
 * Scans `text` for contiguous Russian number-word / digit runs and replaces
 * EACH run with digits (left → right). Punctuation breaks runs so list
 * amounts stay separate.
 *
 * @param {string} text
 * @returns {string}
 */
export function convertSpokenNumbersToDigits(text) {
  const value = String(text ?? "");
  if (!value.trim()) return value;

  const parts = tokenizeForSpokenConversion(value);
  const out = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];

    if (!part || /^\s+$/.test(part) || /^[.,!?;:]+$/.test(part)) {
      out.push(part);
      i += 1;
      continue;
    }

    if (!isNumberToken(part)) {
      out.push(part);
      i += 1;
      continue;
    }

    // Collect one contiguous number-word run (words + intervening spaces only).
    // After a scale word ("тысяч"), a following digit starts a NEW amount
    // ("75 тысяч 25 тысяч" → 75000 + 25000), while word-form continuation
    // stays in-run ("два миллиона пятьсот тысяч").
    const runTokens = [];
    let j = i;
    while (j < parts.length) {
      const token = parts[j];
      if (!(token && isNumberToken(token))) break;

      const clean = stripTrailingPunctuation(token).toLowerCase();
      runTokens.push(stripTrailingPunctuation(token));
      j += 1;

      const closedByScale = clean in SCALES;
      if (j < parts.length && /^\s+$/.test(parts[j])) {
        const next = parts[j + 1];
        if (next && isNumberToken(next)) {
          const nextClean = stripTrailingPunctuation(next).toLowerCase();
          if (closedByScale && /^\d+$/.test(nextClean)) {
            // Digit after scale → separate list amount.
            break;
          }
          j += 1;
          continue;
        }
      }
      if (closedByScale) {
        // End of this amount unless whitespace+continuation handled above.
        const nextIdx = j;
        const next = parts[nextIdx];
        if (next && isNumberToken(next)) {
          const nextClean = stripTrailingPunctuation(next).toLowerCase();
          if (/^\d+$/.test(nextClean)) break;
        } else {
          break;
        }
      }
    }

    const numericValue = parseRussianNumberPhrase(runTokens.join(" "));
    if (numericValue == null) {
      out.push(part);
      i += 1;
      continue;
    }

    out.push(String(numericValue));
    i = j;
  }

  return out.join("");
}
