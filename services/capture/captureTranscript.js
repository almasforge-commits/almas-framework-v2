/**
 * Split long transcripts into semantic segments without dropping text.
 * Pure helpers — no AI / I/O.
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitSemanticSegments(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];

  // Preserve original for callers that need it; segments are for extraction.
  const byLine = raw
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  for (const line of byLine.length ? byLine : [raw]) {
    const parts = line
      .split(
        /(?<=[.!?…])\s+|,\s*(?=и\s|потом\s|затем\s|завтра|послезавтра|запомни|запомнить|есть\s+идея|у\s+меня\s+идея|пришла\s+идея|появилась\s+идея|появилась\s+мысль|надо|нужно|купить|позвонить|напомни|получил|получила|заработал|заработала|потратил|потратила|доход|расход)|(?:^|\s)(?:потом|затем)\s+|;\s+|\s+—\s+|\s+-\s+/iu
      )
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      chunks.push(line);
      continue;
    }

    for (const part of parts) {
      // Re-join very short trailing conjunction fragments.
      if (
        chunks.length &&
        part.length < 12 &&
        /^(и|а|но|also|and)\b/i.test(part)
      ) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}, ${part}`;
      } else {
        chunks.push(part);
      }
    }
  }

  return chunks.length ? chunks : [raw];
}

/**
 * Merge overlapping / duplicate segment strings.
 * @param {string[]} segments
 * @returns {string[]}
 */
export function dedupeSegments(segments) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(segments) ? segments : []) {
    const key = String(s ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(s).trim());
  }
  return out;
}
