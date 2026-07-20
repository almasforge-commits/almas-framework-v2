/**
 * Minimal safe RSS 2.0 / Atom parser — no package, no DOM execution.
 * Extracts known fields only; never evaluates embedded content.
 */

const TITLE_LIMIT = 500;
const SUMMARY_LIMIT = 2000;
const AUTHOR_LIMIT = 300;
const URL_LIMIT = 2000;
const ID_LIMIT = 500;

/**
 * @param {string} xml
 * @returns {{ format: "rss"|"atom"|"unknown", title: string, entries: object[] }}
 */
export function parseFeedXml(xml) {
  const text = String(xml ?? "");
  if (!text.trim()) {
    return { format: "unknown", title: "", entries: [] };
  }

  const head = text.slice(0, 2000).toLowerCase();
  if (head.includes("<feed") && (head.includes("atom") || /<feed[\s>]/.test(head))) {
    return parseAtom(text);
  }
  if (head.includes("<rss") || head.includes("<channel")) {
    return parseRss(text);
  }
  // Fallback probes
  if (/<entry[\s>]/i.test(text) && /<feed[\s>]/i.test(text)) {
    return parseAtom(text);
  }
  if (/<item[\s>]/i.test(text)) {
    return parseRss(text);
  }
  return { format: "unknown", title: "", entries: [] };
}

function parseRss(xml) {
  const channel = firstBlock(xml, "channel") || xml;
  const channelTitle = sanitizeFeedText(innerText(firstTag(channel, "title")));
  const items = allBlocks(channel, "item");
  const entries = items.map((item) => {
    const title = sanitizeFeedText(innerText(firstTag(item, "title")));
    const link = sanitizeUrl(
      innerText(firstTag(item, "link")) || attrValue(firstTagRaw(item, "link"), "href")
    );
    const description = sanitizeFeedText(
      innerText(firstTag(item, "description")) ||
        innerText(firstTag(item, "content:encoded"))
    );
    const author = sanitizeFeedText(
      innerText(firstTag(item, "author")) ||
        innerText(firstTag(item, "dc:creator"))
    );
    const guid = sanitizeFeedText(innerText(firstTag(item, "guid")));
    const pubDate = parseDate(innerText(firstTag(item, "pubDate")));
    return {
      title: title.slice(0, TITLE_LIMIT),
      summary: description.slice(0, SUMMARY_LIMIT),
      url: link ? link.slice(0, URL_LIMIT) : null,
      author: author ? author.slice(0, AUTHOR_LIMIT) : null,
      entryId: (guid || link || title).slice(0, ID_LIMIT),
      publishedAt: pubDate,
    };
  });
  return { format: "rss", title: channelTitle, entries };
}

function parseAtom(xml) {
  const feedTitle = sanitizeFeedText(innerText(firstTag(xml, "title")));
  const entriesXml = allBlocks(xml, "entry");
  const entries = entriesXml.map((entry) => {
    const title = sanitizeFeedText(innerText(firstTag(entry, "title")));
    const link =
      pickAtomLink(entry) ||
      sanitizeUrl(innerText(firstTag(entry, "link")));
    const summary = sanitizeFeedText(
      innerText(firstTag(entry, "summary")) ||
        innerText(firstTag(entry, "content"))
    );
    const authorBlock = firstBlock(entry, "author") || "";
    const author = sanitizeFeedText(innerText(firstTag(authorBlock, "name")));
    const id = sanitizeFeedText(innerText(firstTag(entry, "id")));
    const publishedAt =
      parseDate(innerText(firstTag(entry, "updated"))) ??
      parseDate(innerText(firstTag(entry, "published")));
    return {
      title: title.slice(0, TITLE_LIMIT),
      summary: summary.slice(0, SUMMARY_LIMIT),
      url: link ? link.slice(0, URL_LIMIT) : null,
      author: author ? author.slice(0, AUTHOR_LIMIT) : null,
      entryId: (id || link || title).slice(0, ID_LIMIT),
      publishedAt,
    };
  });
  return { format: "atom", title: feedTitle, entries };
}

function pickAtomLink(entry) {
  const linkTags = entry.match(/<link\b[^>]*>/gi) || [];
  let fallback = null;
  for (const tag of linkTags) {
    const href = attrValue(tag, "href");
    if (!href) continue;
    const rel = (attrValue(tag, "rel") || "alternate").toLowerCase();
    const url = sanitizeUrl(href);
    if (!url) continue;
    if (rel === "alternate") return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

/**
 * Remove scripts/styles/iframes/markup; decode common entities; collapse space.
 * @param {string} value
 */
export function sanitizeFeedText(value) {
  let s = String(value ?? "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  s = s.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  s = decodeBasicEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function decodeBasicEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      if (!Number.isFinite(code) || code < 32) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      if (!Number.isFinite(code) || code < 32) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    });
}

function sanitizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(String(value).trim());
  return Number.isFinite(t) ? t : null;
}

function firstBlock(xml, tag) {
  const re = new RegExp(
    `<${escapeReg(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeReg(tag)}>`,
    "i"
  );
  const m = re.exec(xml);
  return m ? m[1] : null;
}

function allBlocks(xml, tag) {
  const re = new RegExp(
    `<${escapeReg(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeReg(tag)}>`,
    "gi"
  );
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    out.push(m[1]);
    if (out.length > 500) break;
  }
  return out;
}

function firstTag(xml, tag) {
  const re = new RegExp(
    `<${escapeReg(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeReg(tag)}>`,
    "i"
  );
  const m = re.exec(xml);
  return m ? m[1] : "";
}

function firstTagRaw(xml, tag) {
  const re = new RegExp(`<${escapeReg(tag)}\\b[^>]*>`, "i");
  const m = re.exec(xml);
  return m ? m[0] : "";
}

function innerText(fragment) {
  return String(fragment ?? "");
}

function attrValue(tag, name) {
  const re = new RegExp(
    `${escapeReg(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(String(tag ?? ""));
  return m ? m[1] ?? m[2] ?? null : null;
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
