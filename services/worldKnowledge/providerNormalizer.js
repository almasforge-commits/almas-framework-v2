/**
 * Normalize provider outputs into the closed contract (never HTML).
 */

import { createProviderResult } from "./providerContracts.js";
import { validateProviderResult } from "./providerValidator.js";

/**
 * Strip residual markup if somehow present.
 * @param {string} text
 */
export function stripMarkup(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} raw
 * @param {string} [fallbackProvider]
 */
export function normalizeProviderResult(raw, fallbackProvider = "unknown") {
  if (!raw || typeof raw !== "object") return null;

  const candidate = createProviderResult({
    ...raw,
    provider: raw.provider || fallbackProvider,
    title: stripMarkup(raw.title),
    summary: stripMarkup(raw.summary ?? raw.content ?? raw.text),
    author: raw.author == null ? null : stripMarkup(raw.author),
  });

  const validation = validateProviderResult(candidate);
  if (!validation.ok) return null;
  return candidate;
}

/**
 * @param {unknown[]} rows
 * @param {string} providerId
 */
export function normalizeProviderResults(rows, providerId) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const n = normalizeProviderResult(row, providerId);
    if (n) out.push(n);
  }
  return out;
}
