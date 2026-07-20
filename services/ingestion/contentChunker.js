/**
 * Content chunker — reusable, wraps core/utils/chunkText.
 * Adds stable chunk ids + checksums. Future-ready for embeddings.
 */

import { chunkText } from "../../core/utils/chunkText.js";
import { checksumText } from "./normalizedDocument.js";

/**
 * @param {string} content
 * @param {object} [options]
 * @param {string} [options.documentId]
 * @param {number} [options.chunkSize]
 * @param {number} [options.chunkOverlap]
 * @param {string} [options.language]
 */
export function chunkDocumentContent(content, options = {}) {
  const documentId = String(options.documentId || "doc");
  const maxChars = options.chunkSize ?? options.maxChars ?? 2000;
  const overlapChars = options.chunkOverlap ?? options.overlapChars ?? 200;

  const raw = chunkText(content, { maxChars, overlapChars });

  return raw.map((c) => {
    const checksum = checksumText(c.content);
    const id = `${documentId}:chunk:${c.index}:${checksum}`;
    return {
      id,
      index: c.index,
      content: c.content,
      charStart: c.charStart,
      charEnd: c.charEnd,
      tokenCount: c.tokenCount,
      checksum,
      language: options.language || null,
      documentId,
      /** Placeholder for future embedding vector — never populated here. */
      embedding: null,
    };
  });
}
