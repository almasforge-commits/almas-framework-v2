/**
 * Detects bare, context-free input that must never call Tier 1/Tier 2
 * and must never be auto-saved as Memory: empty text, pure numbers with
 * no command words, and single punctuation characters.
 *
 * Deliberately does NOT match real commands that merely contain numbers:
 * "открыть 4", "выполнено 4", "расход 40000 кофе". No conversation/
 * selection state is consulted — this is a pure string check only.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isMeaninglessShortInput(text) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) return true;

  // Pure numeric (digits + optional internal whitespace only), e.g. "4",
  // "40000", "40 000". Any letter or command word disqualifies this.
  if (/^[\d\s]+$/.test(trimmed) && /\d/.test(trimmed)) {
    return true;
  }

  // One-character punctuation / symbol (not a letter or digit).
  if (trimmed.length === 1 && !/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  return false;
}
