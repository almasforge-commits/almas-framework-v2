/**
 * Conflict resolution — never silently merge contradictions.
 * Prefer: Personal → verified domain → Reasoning → world.
 * Keep both; mark conflict only when contradiction is grounded.
 *
 * Unrelated same-domain memories must NOT conflict.
 */

import { SCOPE_PRIORITY, normalizeAnswerText } from "./answerContracts.js";

/**
 * Detect and mark conflicts. Does not drop either side.
 * @param {object[]} evidence
 * @returns {{ evidence: object[], conflicts: object[] }}
 */
export function resolveEvidenceConflicts(evidence) {
  if (!Array.isArray(evidence) || evidence.length < 2) {
    return { evidence: evidence || [], conflicts: [] };
  }

  const conflicts = [];
  const marked = evidence.map((e) => ({ ...e }));

  for (let i = 0; i < marked.length; i += 1) {
    for (let j = i + 1; j < marked.length; j += 1) {
      const a = marked[i];
      const b = marked[j];
      if (!sameTopic(a, b)) continue;
      if (!disagree(a, b)) continue;

      const group = `c_${stablePair(a.id || i, b.id || j)}`;
      const preferred = prefer(a, b);

      a.conflict = true;
      b.conflict = true;
      a.conflictGroup = group;
      b.conflictGroup = group;

      conflicts.push({
        type:
          (a.scope === "personal" && b.scope === "world") ||
          (a.scope === "world" && b.scope === "personal")
            ? "personal_vs_world"
            : "contradiction",
        group,
        preferredId: preferred.id ?? null,
        preferredScope: preferred.scope,
        resolutionPolicy: "personal_priority",
        personalEvidence: evidenceRef(
          a.scope === "personal" ? a : b.scope === "personal" ? b : null
        ),
        worldEvidence: evidenceRef(
          a.scope === "world" ? a : b.scope === "world" ? b : null
        ),
        leftId: a.id ?? null,
        rightId: b.id ?? null,
        leftScope: a.scope,
        rightScope: b.scope,
        reason: "contradiction",
      });
    }
  }

  marked.sort((x, y) => {
    const px = SCOPE_PRIORITY[x.scope] ?? 9;
    const py = SCOPE_PRIORITY[y.scope] ?? 9;
    if (px !== py) return px - py;
    return (y.confidence || 0) - (x.confidence || 0);
  });

  return { evidence: marked, conflicts };
}

function evidenceRef(item) {
  if (!item) return null;
  return {
    id: item.id ?? null,
    scope: item.scope,
    source: item.source,
    summary: item.summary || item.content || null,
    confidence: item.confidence ?? null,
    provenance: item.provenance ?? null,
  };
}

/**
 * Topic identity requires grounded sameness — never domain alone.
 */
function sameTopic(a, b) {
  const keyA = explicitFactKey(a);
  const keyB = explicitFactKey(b);
  if (keyA && keyB && keyA === keyB) return true;

  const ca = extractClaim(a.content || a.summary);
  const cb = extractClaim(b.content || b.summary);
  if (!ca.core || !cb.core) return false;

  // Same structured attribute (e.g. favorite color / любимый цвет).
  if (ca.attrKey && cb.attrKey && ca.attrKey === cb.attrKey) {
    return true;
  }

  // Preference / attitude claims: require strong object overlap.
  if (ca.kind === "attitude" && cb.kind === "attitude") {
    return coresAlign(ca.object || ca.core, cb.object || cb.core);
  }

  // Generic claims: require high lexical overlap on claim cores.
  return coresAlign(ca.core, cb.core);
}

/**
 * Contradiction only when polarity/value conflict is grounded on same topic.
 */
function disagree(a, b) {
  const na = normalizeAnswerText(a.content || a.summary);
  const nb = normalizeAnswerText(b.content || b.summary);
  if (!na || !nb) return false;
  if (na === nb) return false;

  const ca = extractClaim(na);
  const cb = extractClaim(nb);

  // Exclusive categorical values for the same attribute.
  if (
    ca.attrKey &&
    cb.attrKey &&
    ca.attrKey === cb.attrKey &&
    ca.attrValue &&
    cb.attrValue &&
    ca.attrValue !== cb.attrValue
  ) {
    return true;
  }

  // Numeric disagreement only when cores align strongly.
  if (coresAlign(ca.core, cb.core)) {
    const numA = na.match(/-?\d+(?:[.,]\d+)?/);
    const numB = nb.match(/-?\d+(?:[.,]\d+)?/);
    if (numA && numB && numA[0] !== numB[0]) return true;
  }

  // Negation / polarity conflict on the same subject/object.
  if (ca.polarity !== 0 && cb.polarity !== 0 && ca.polarity !== cb.polarity) {
    const left = ca.object || ca.core;
    const right = cb.object || cb.core;
    if (coresAlign(left, right)) return true;
  }

  // One side explicit negation markers, other affirmative, same core.
  if (ca.negated !== cb.negated) {
    const left = stripPolarity(ca.object || ca.core);
    const right = stripPolarity(cb.object || cb.core);
    if (coresAlign(left, right)) return true;
  }

  return false;
}

function explicitFactKey(item) {
  if (!item || typeof item !== "object") return null;
  const raw =
    item.factKey ??
    item.provenance?.factKey ??
    (item.reason && String(item.reason).startsWith("fact:")
      ? item.reason
      : null);
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).trim().toLowerCase();
}

/**
 * @param {string} text
 * @returns {{
 *   kind: string,
 *   core: string,
 *   object: string,
 *   polarity: number,
 *   negated: boolean,
 *   attrKey: string|null,
 *   attrValue: string|null
 * }}
 */
function extractClaim(text) {
  const n = normalizeAnswerText(text);
  const empty = {
    kind: "generic",
    core: n,
    object: n,
    polarity: 0,
    negated: false,
    attrKey: null,
    attrValue: null,
  };
  if (!n) return empty;

  // Favorite / любимый <attr> <value>
  const fav =
    n.match(
      /(?:мой\s+)?любим(?:ый|ая|ое)\s+([a-zа-яё0-9]+)\s+([a-zа-яё0-9]+)/iu
    ) ||
    n.match(
      /(?:my\s+)?favou?rite\s+([a-zа-яё0-9]+)\s+(?:is\s+)?([a-zа-яё0-9]+)/iu
    );
  if (fav) {
    const attr = normalizeToken(fav[1]);
    const value = normalizeToken(fav[2]);
    return {
      kind: "attribute",
      core: `${attr} ${value}`,
      object: value,
      polarity: 1,
      negated: false,
      attrKey: `favorite:${attr}`,
      attrValue: value,
    };
  }

  // Attitude / preference verbs (RU + EN), including dislike / не …
  const attitude = matchAttitude(n);
  if (attitude) {
    return {
      kind: "attitude",
      core: attitude.object || n,
      object: attitude.object || n,
      polarity: attitude.polarity,
      negated: attitude.polarity < 0,
      attrKey: null,
      attrValue: null,
    };
  }

  const negated = hasNegation(n);
  return {
    kind: "generic",
    core: stripPolarity(n),
    object: stripPolarity(n),
    polarity: negated ? -1 : 1,
    negated,
    attrKey: null,
    attrValue: null,
  };
}

function matchAttitude(n) {
  // Avoid JS \b with Cyrillic — it treats letters as non-word and breaks matches.
  // Ordered: longer / more specific first.
  const patterns = [
    {
      re: /(?:^|[^a-zа-яё0-9])(?:мне\s+)?не\s+нравится\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])(?:мне\s+)?нравится\s+(.+)$/iu,
      polarity: 1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])не\s+люблю\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])люблю\s+(.+)$/iu,
      polarity: 1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])не\s+предпочитаю\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])предпочитаю\s+(.+)$/iu,
      polarity: 1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])не\s+пью\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /(?:^|[^a-zа-яё0-9])пью\s+(.+)$/iu,
      polarity: 1,
    },
    {
      re: /\b(?:do\s+not|don't|does\s+not|doesn't)\s+(?:like|love|prefer|drink)\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /\bdislike(?:s)?\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /\b(?:like|love|prefer|drink)s?\s+(.+)$/iu,
      polarity: 1,
    },
    {
      re: /\bnever\s+(.+)$/iu,
      polarity: -1,
    },
    {
      re: /\balways\s+(.+)$/iu,
      polarity: 1,
    },
  ];

  for (const p of patterns) {
    const m = n.match(p.re);
    if (!m) continue;
    const object = stripPolarity(String(m[1] || "").trim());
    if (!object) continue;
    return { object, polarity: p.polarity };
  }

  // Start-anchored RU forms (no leading boundary needed).
  const startPatterns = [
    { re: /^(?:мне\s+)?не\s+нравится\s+(.+)$/iu, polarity: -1 },
    { re: /^(?:мне\s+)?нравится\s+(.+)$/iu, polarity: 1 },
    { re: /^я\s+не\s+люблю\s+(.+)$/iu, polarity: -1 },
    { re: /^я\s+люблю\s+(.+)$/iu, polarity: 1 },
    { re: /^я\s+не\s+предпочитаю\s+(.+)$/iu, polarity: -1 },
    { re: /^я\s+предпочитаю\s+(.+)$/iu, polarity: 1 },
    { re: /^я\s+не\s+пью\s+(.+)$/iu, polarity: -1 },
    { re: /^я\s+пью\s+(.+)$/iu, polarity: 1 },
  ];
  for (const p of startPatterns) {
    const m = n.match(p.re);
    if (!m) continue;
    const object = stripPolarity(String(m[1] || "").trim());
    if (!object) continue;
    return { object, polarity: p.polarity };
  }

  return null;
}

function hasNegation(s) {
  const t = String(s ?? "");
  if (/\b(do\s+not|don't|does\s+not|doesn't|never|not)\b/iu.test(t)) {
    return true;
  }
  // Cyrillic: avoid \b
  return /(?:^|[^a-zа-яё0-9])(?:нет|не)(?:[^a-zа-яё0-9]|$)/iu.test(t);
}

function stripPolarity(s) {
  return String(s ?? "")
    .replace(/\bdo\s+not\b/giu, " ")
    .replace(/\bdon't\b/giu, " ")
    .replace(/\bdoes\s+not\b/giu, " ")
    .replace(/\bdoesn't\b/giu, " ")
    .replace(/\bnever\b/giu, " ")
    .replace(/\bdislike(?:s)?\b/giu, " ")
    .replace(/(?:^|[^a-zа-яё0-9])не\s+нравится\b/giu, " ")
    .replace(/(?:^|[^a-zа-яё0-9])не\s+люблю\b/giu, " ")
    .replace(/(?:^|[^a-zа-яё0-9])не\s+предпочитаю\b/giu, " ")
    .replace(/(?:^|[^a-zа-яё0-9])не\s+пью\b/giu, " ")
    .replace(/(?:^|[^a-zа-яё0-9])не\s+/giu, " ")
    .replace(/(?:^|[^a-zа-яё0-9])нет(?:[^a-zа-яё0-9]|$)/giu, " ")
    .replace(/\bnot\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coresAlign(a, b) {
  const left = normalizeAnswerText(a);
  const right = normalizeAnswerText(b);
  if (!left || !right) return false;
  if (left === right) return true;

  // Substantial containment of claim cores (not single short tokens).
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;

  const ta = topicTokens(left);
  const tb = topicTokens(right);
  if (!ta.size || !tb.size) return false;

  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared += 1;
  }
  if (shared === 0) return false;

  const jaccard = shared / (ta.size + tb.size - shared);
  const coverage = shared / Math.min(ta.size, tb.size);

  // Strong overlap required — partial token overlap alone is not enough.
  return jaccard >= 0.5 || (shared >= 2 && coverage >= 0.7);
}

function prefer(a, b) {
  const pa = SCOPE_PRIORITY[a.scope] ?? 9;
  const pb = SCOPE_PRIORITY[b.scope] ?? 9;
  if (pa !== pb) return pa < pb ? a : b;
  if ((a.confidence || 0) !== (b.confidence || 0)) {
    return (a.confidence || 0) > (b.confidence || 0) ? a : b;
  }
  return (a.timestamp || 0) >= (b.timestamp || 0) ? a : b;
}

function topicTokens(text) {
  const stop = new Set([
    "и",
    "в",
    "на",
    "the",
    "a",
    "an",
    "to",
    "of",
    "is",
    "я",
    "мне",
    "my",
    "i",
    "что",
    "это",
    "like",
    "love",
    "prefer",
    "нравится",
    "люблю",
    "предпочитаю",
  ]);
  const set = new Set();
  for (const t of String(text ?? "")
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/iu)) {
    if (t.length < 3 || stop.has(t)) continue;
    set.add(normalizeToken(t));
  }
  return set;
}

function normalizeToken(t) {
  return String(t ?? "")
    .toLowerCase()
    .trim();
}

function stablePair(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}
