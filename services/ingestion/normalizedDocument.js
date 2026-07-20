/**
 * Normalized Document contract — every source adapter must emit this shape.
 */

export const SOURCE_TYPES = Object.freeze([
  "youtube",
  "pdf",
  "docx",
  "txt",
  "markdown",
  "html",
  "web",
  "text",
  "image",
  "email",
  "calendar",
  "whoop",
  "google_drive",
  "dropbox",
  "unknown",
]);

/**
 * Stable non-crypto checksum for provenance / dedupe.
 * @param {string} input
 */
export function checksumText(input) {
  const s = String(input ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ck_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Lightweight language hint (RU/EN/unknown) — no LLM.
 * @param {string} text
 */
export function detectLanguageHint(text) {
  const sample = String(text ?? "").slice(0, 2000);
  if (!sample.trim()) return "unknown";
  const cyr = (sample.match(/[а-яёА-ЯЁ]/g) || []).length;
  const lat = (sample.match(/[a-zA-Z]/g) || []).length;
  if (cyr === 0 && lat === 0) return "unknown";
  if (cyr > lat * 0.5) return "ru";
  if (lat > cyr * 0.5) return "en";
  return cyr >= lat ? "ru" : "en";
}

/**
 * @param {object} input
 */
export function createNormalizedDocument(input = {}) {
  const now = Date.now();
  const content = String(input.content ?? "");
  const sourceType = SOURCE_TYPES.includes(input.sourceType)
    ? input.sourceType
    : "unknown";

  const checksum =
    typeof input.checksum === "string" && input.checksum.trim()
      ? input.checksum.trim()
      : checksumText(content);

  const metadata =
    input.metadata && typeof input.metadata === "object"
      ? { ...input.metadata }
      : {};

  if (input.mimeType && !metadata.mimeType) {
    metadata.mimeType = String(input.mimeType);
  }
  if (input.originalSource && !metadata.originalSource) {
    metadata.originalSource = input.originalSource;
  }

  return {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : `doc_${checksum}`,
    sourceType,
    title: String(input.title ?? "").slice(0, 500),
    author: input.author == null ? null : String(input.author).slice(0, 300),
    url: input.url == null ? null : String(input.url).slice(0, 2000),
    language:
      input.language ||
      detectLanguageHint(content) ||
      "unknown",
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
    metadata,
    content,
    sections: Array.isArray(input.sections)
      ? input.sections.map(normalizeSection).filter(Boolean)
      : [],
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map(normalizeAttachment).filter(Boolean)
      : [],
    checksum,
  };
}

function normalizeSection(s) {
  if (!s || typeof s !== "object") return null;
  return {
    id: s.id != null ? String(s.id) : null,
    title: s.title != null ? String(s.title).slice(0, 300) : null,
    content: String(s.content ?? "").slice(0, 100_000),
  };
}

function normalizeAttachment(a) {
  if (!a || typeof a !== "object") return null;
  return {
    name: a.name != null ? String(a.name).slice(0, 300) : null,
    mimeType: a.mimeType != null ? String(a.mimeType).slice(0, 120) : null,
    url: a.url != null ? String(a.url).slice(0, 2000) : null,
  };
}

/**
 * Map normalized document → legacy pipeline metadata.source shape.
 */
export function toPipelineSourceMetadata(doc) {
  return {
    type: doc.sourceType,
    title: doc.title,
    url: doc.url,
    author: doc.author,
    duration: doc.metadata?.duration ?? null,
    extra: {
      checksum: doc.checksum,
      language: doc.language,
      mimeType: doc.metadata?.mimeType ?? null,
      originalSource: doc.metadata?.originalSource ?? null,
      ...(doc.metadata?.extra && typeof doc.metadata.extra === "object"
        ? doc.metadata.extra
        : {}),
    },
  };
}
