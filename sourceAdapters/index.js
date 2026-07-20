/**
 * Source adapter registry — convert raw input → NormalizedDocument only.
 * No extraction / chunking / storage here.
 */

import { createNormalizedDocument } from "../services/ingestion/normalizedDocument.js";

/**
 * @param {object} raw
 * @param {object} [opts]
 */
export function adaptText(raw = {}, opts = {}) {
  const content = String(raw.text ?? raw.content ?? raw.body ?? "");
  return createNormalizedDocument({
    sourceType: "text",
    title: raw.title || opts.title || "Plain text",
    author: raw.author ?? null,
    url: raw.url ?? null,
    language: raw.language,
    content,
    mimeType: raw.mimeType || "text/plain",
    originalSource: raw.originalSource || "text",
    metadata: { ...(raw.metadata || {}), mimeType: "text/plain" },
    sections: raw.sections,
    attachments: raw.attachments,
    id: raw.id,
  });
}

/**
 * @param {object} raw
 */
export function adaptMarkdown(raw = {}, opts = {}) {
  const content = String(raw.text ?? raw.content ?? raw.markdown ?? "");
  const title =
    raw.title ||
    opts.title ||
    extractMarkdownTitle(content) ||
    "Markdown document";
  const sections = raw.sections || extractMarkdownSections(content);
  return createNormalizedDocument({
    sourceType: "markdown",
    title,
    author: raw.author ?? null,
    url: raw.url ?? null,
    language: raw.language,
    content,
    mimeType: "text/markdown",
    originalSource: raw.originalSource || "markdown",
    metadata: { ...(raw.metadata || {}), mimeType: "text/markdown" },
    sections,
    attachments: raw.attachments,
    id: raw.id,
  });
}

/**
 * Pure HTML → text (no cheerio). Strips tags/scripts/styles.
 * @param {object} raw
 */
export function adaptHtml(raw = {}, opts = {}) {
  const html = String(raw.html ?? raw.content ?? raw.text ?? "");
  const content = stripHtml(html);
  const title =
    raw.title ||
    opts.title ||
    extractHtmlTitle(html) ||
    "HTML document";
  return createNormalizedDocument({
    sourceType: "html",
    title,
    author: raw.author ?? null,
    url: raw.url ?? null,
    language: raw.language,
    content,
    mimeType: "text/html",
    originalSource: raw.originalSource || "html",
    metadata: {
      ...(raw.metadata || {}),
      mimeType: "text/html",
      htmlLength: html.length,
    },
    sections: raw.sections,
    attachments: raw.attachments,
    id: raw.id,
  });
}

/**
 * Web URL adapter — requires fetched body (text/html/markdown) via DI.
 * Does not perform network I/O itself unless fetchFn injected.
 * @param {object} raw
 * @param {object} [deps]
 */
export async function adaptWeb(raw = {}, deps = {}) {
  let body = raw.html ?? raw.content ?? raw.text ?? null;
  const url = raw.url || raw.href || null;

  if (body == null && url && typeof deps.fetchFn === "function") {
    const fetched = await deps.fetchFn(url, raw.fetchOpts || {});
    body = fetched?.body ?? fetched?.text ?? fetched?.html ?? "";
    if (!raw.title && fetched?.title) raw = { ...raw, title: fetched.title };
  }

  const htmlish =
    typeof body === "string" && /<\/?[a-z][\s\S]*>/i.test(body);
  if (htmlish) {
    return adaptHtml(
      {
        ...raw,
        html: String(body),
        url,
        originalSource: raw.originalSource || "web",
      },
      deps
    );
  }

  const doc = adaptText(
    {
      ...raw,
      text: String(body ?? ""),
      url,
      title: raw.title || url || "Web document",
      originalSource: raw.originalSource || "web",
      mimeType: raw.mimeType || "text/plain",
    },
    deps
  );
  return { ...doc, sourceType: "web" };
}

/**
 * PDF adapter — no pdf-parse installed.
 * Accepts pre-extracted `text` / `content`. Binary-only → clear error.
 */
export function adaptPdf(raw = {}, opts = {}) {
  const text = raw.text ?? raw.content ?? raw.extractedText ?? null;
  if (text == null || String(text).trim() === "") {
    if (raw.buffer || raw.bytes || raw.data) {
      throw new Error("pdf_parser_unavailable");
    }
    throw new Error("pdf_missing_text");
  }
  return createNormalizedDocument({
    sourceType: "pdf",
    title: raw.title || opts.title || "PDF document",
    author: raw.author ?? null,
    url: raw.url ?? null,
    language: raw.language,
    content: String(text),
    mimeType: "application/pdf",
    originalSource: raw.originalSource || "pdf",
    metadata: {
      ...(raw.metadata || {}),
      mimeType: "application/pdf",
      pages: raw.pages ?? null,
    },
    sections: raw.sections,
    attachments: raw.attachments,
    id: raw.id,
  });
}

/**
 * DOCX adapter — no mammoth installed.
 * Accepts pre-extracted text, or crude XML text strip from OOXML XML string.
 */
export function adaptDocx(raw = {}, opts = {}) {
  let text = raw.text ?? raw.content ?? raw.extractedText ?? null;
  if ((text == null || String(text).trim() === "") && raw.xml) {
    text = stripOoxml(String(raw.xml));
  }
  if (text == null || String(text).trim() === "") {
    if (raw.buffer || raw.bytes || raw.data) {
      throw new Error("docx_parser_unavailable");
    }
    throw new Error("docx_missing_text");
  }
  return createNormalizedDocument({
    sourceType: "docx",
    title: raw.title || opts.title || "DOCX document",
    author: raw.author ?? null,
    url: raw.url ?? null,
    language: raw.language,
    content: String(text),
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    originalSource: raw.originalSource || "docx",
    metadata: {
      ...(raw.metadata || {}),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    sections: raw.sections,
    attachments: raw.attachments,
    id: raw.id,
  });
}

/**
 * YouTube adapter — reuses existing video info loader when provided.
 * Transcript must be supplied (or via loadTranscriptFn) — does not replace
 * the existing YouTube workflow.
 */
export async function adaptYouTube(raw = {}, deps = {}) {
  const url = raw.url || raw.input?.url || null;
  let title = raw.title || "";
  let author = raw.author || null;
  let duration = raw.duration ?? null;
  let content = raw.transcript ?? raw.content ?? raw.text ?? "";

  if (typeof deps.getYouTubeVideoInfoFn === "function" && url) {
    const info = await deps.getYouTubeVideoInfoFn(url);
    if (info) {
      title = title || info.title || "";
      author = author || info.channel || null;
      duration = duration ?? info.duration ?? null;
    }
  }

  if (
    (!content || !String(content).trim()) &&
    typeof deps.loadTranscriptFn === "function" &&
    url
  ) {
    content = (await deps.loadTranscriptFn(url)) || "";
  }

  return createNormalizedDocument({
    sourceType: "youtube",
    title: title || "YouTube video",
    author,
    url,
    language: raw.language,
    content: String(content),
    mimeType: "text/plain",
    originalSource: raw.originalSource || "youtube",
    metadata: {
      ...(raw.metadata || {}),
      mimeType: "text/plain",
      duration,
      extra: { duration },
    },
    sections: raw.sections,
    attachments: raw.attachments,
    id: raw.id,
  });
}

/** Future-ready stubs — interfaces only. */
export const FUTURE_ADAPTERS = Object.freeze({
  image: createFutureAdapter("image", "image_ocr_not_implemented"),
  email: createFutureAdapter("email", "email_adapter_not_implemented"),
  calendar: createFutureAdapter("calendar", "calendar_adapter_not_implemented"),
  whoop: createFutureAdapter("whoop", "whoop_adapter_not_implemented"),
  google_drive: createFutureAdapter(
    "google_drive",
    "google_drive_adapter_not_implemented"
  ),
  dropbox: createFutureAdapter("dropbox", "dropbox_adapter_not_implemented"),
});

function createFutureAdapter(sourceType, errorCode) {
  return async function futureAdapter() {
    const err = new Error(errorCode);
    err.code = errorCode;
    err.sourceType = sourceType;
    throw err;
  };
}

export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 300) : null;
}

function extractMarkdownTitle(md) {
  const m = String(md).match(/^#\s+(.+)$/m);
  return m ? m[1].trim().slice(0, 300) : null;
}

function extractMarkdownSections(md) {
  const sections = [];
  const parts = String(md).split(/^##\s+/m);
  if (parts.length <= 1) return sections;
  for (let i = 1; i < parts.length; i += 1) {
    const block = parts[i];
    const nl = block.indexOf("\n");
    const title = (nl === -1 ? block : block.slice(0, nl)).trim();
    const content = (nl === -1 ? "" : block.slice(nl + 1)).trim();
    sections.push({ id: `h2_${i}`, title, content });
  }
  return sections;
}

function stripOoxml(xml) {
  return String(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve adapter by sourceType.
 */
export function getSourceAdapter(sourceType) {
  const map = {
    text: adaptText,
    txt: adaptText,
    markdown: adaptMarkdown,
    md: adaptMarkdown,
    html: adaptHtml,
    web: adaptWeb,
    pdf: adaptPdf,
    docx: adaptDocx,
    youtube: adaptYouTube,
    ...Object.fromEntries(
      Object.entries(FUTURE_ADAPTERS).map(([k, fn]) => [k, fn])
    ),
  };
  return map[sourceType] || null;
}
