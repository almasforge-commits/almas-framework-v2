const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 200;
const BOUNDARY_WINDOW = 200;

// Order matters only in that each terminator is searched independently;
// the rightmost match across all of them wins. Covers English and
// Cyrillic sentence punctuation (Cyrillic uses the same ".", "!", "?").
const SENTENCE_TERMINATORS = [". ", "! ", "? ", ".\n", "!\n", "?\n"];

/**
 * Splits text into overlapping chunks for embedding/RAG.
 *
 * Pure function, no external dependency. Works the same for Cyrillic and
 * English text since it operates on generic whitespace/punctuation
 * boundaries, not a language-specific tokenizer.
 *
 * @param {string} text
 * @param {{ maxChars?: number, overlapChars?: number }} options
 * @returns {Array<{ index: number, content: string, charStart: number, charEnd: number, tokenCount: number }>}
 */
export function chunkText(text, options = {}) {

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  validateConfig(maxChars, overlapChars);

  const trimmed = String(text ?? "").trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return [singleChunk(trimmed, 0, 0, trimmed.length)];
  }

  const chunks = [];
  let start = 0;
  let index = 0;
  let lastRange = null;

  while (start < trimmed.length) {

    const targetEnd = Math.min(start + maxChars, trimmed.length);

    const end = targetEnd === trimmed.length
      ? targetEnd
      : findBoundary(trimmed, start, targetEnd);

    const rawSlice = trimmed.slice(start, end);
    const leadingWhitespace = rawSlice.length - rawSlice.trimStart().length;
    const content = rawSlice.trim();

    if (content) {

      const actualStart = start + leadingWhitespace;
      const actualEnd = actualStart + content.length;

      // Defensive guard: structurally this shouldn't happen (start always
      // makes forward progress below), but never emit two chunks with the
      // exact same range.
      if (!lastRange || lastRange.start !== actualStart || lastRange.end !== actualEnd) {
        chunks.push(singleChunk(content, index, actualStart, actualEnd));
        index++;
        lastRange = { start: actualStart, end: actualEnd };
      }

    }

    if (end >= trimmed.length) {
      break;
    }

    // Guarantees forward progress every iteration (end is always > start),
    // which is what makes this loop provably terminating.
    start = Math.max(end - overlapChars, start + 1);

  }

  return chunks;

}

function validateConfig(maxChars, overlapChars) {

  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new Error("chunkText: maxChars must be a positive number.");
  }

  if (!Number.isFinite(overlapChars) || overlapChars < 0) {
    throw new Error("chunkText: overlapChars must be zero or a positive number.");
  }

  if (overlapChars >= maxChars) {
    throw new Error("chunkText: overlapChars must be smaller than maxChars.");
  }

}

function singleChunk(content, index, charStart, charEnd) {

  return {
    index,
    content,
    charStart,
    charEnd,
    tokenCount: estimateTokenCount(content),
  };

}

function findBoundary(text, start, targetEnd) {

  const windowStart = Math.max(start + 1, targetEnd - BOUNDARY_WINDOW);
  const window = text.slice(windowStart, targetEnd);

  const paragraphBreak = window.lastIndexOf("\n\n");
  if (paragraphBreak !== -1) {
    return windowStart + paragraphBreak + 2;
  }

  const lineBreak = window.lastIndexOf("\n");
  if (lineBreak !== -1) {
    return windowStart + lineBreak + 1;
  }

  const sentenceBreak = findLastSentenceBreak(window);
  if (sentenceBreak !== -1) {
    return windowStart + sentenceBreak;
  }

  return targetEnd;

}

function findLastSentenceBreak(window) {

  let best = -1;

  for (const terminator of SENTENCE_TERMINATORS) {
    const idx = window.lastIndexOf(terminator);
    if (idx !== -1) {
      const boundary = idx + terminator.length;
      if (boundary > best) {
        best = boundary;
      }
    }
  }

  return best;

}

function estimateTokenCount(content) {

  // Rough heuristic (no tokenizer dependency): ~4 chars per token.
  return Math.max(1, Math.round(content.length / 4));

}
