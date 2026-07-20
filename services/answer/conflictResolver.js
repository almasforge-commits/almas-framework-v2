/**
 * Conflict resolution — never silently merge contradictions.
 * Prefer: Personal → verified domain → Reasoning → world.
 * Keep both; mark conflict.
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

  // Group by domain + topic token; flag polarity / value disagreements.
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

  // Stable order: preferred scopes first within a conflict group for consumers,
  // but keep all items.
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

function sameTopic(a, b) {
  if (a.domain && b.domain && String(a.domain) === String(b.domain)) {
    return true;
  }
  const ta = topicTokens(a.content || a.summary);
  const tb = topicTokens(b.content || b.summary);
  if (!ta.size || !tb.size) return false;
  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap += 1;
  }
  return overlap >= 1 && overlap / Math.min(ta.size, tb.size) >= 0.4;
}

function disagree(a, b) {
  const na = normalizeAnswerText(a.content || a.summary);
  const nb = normalizeAnswerText(b.content || b.summary);
  if (!na || !nb) return false;
  if (na === nb) return false;

  const stripPolarity = (s) =>
    s
      .replace(/\bdo\s+not\b/g, " ")
      .replace(/\bdon't\b/g, " ")
      .replace(/\bdoes\s+not\b/g, " ")
      .replace(/\bdoesn't\b/g, " ")
      .replace(/\bnever\b/g, " ")
      .replace(/\bне\s+/g, " ")
      .replace(/\bнет\b/g, " ")
      .replace(/\bnot\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const negA = /\b(do\s+not|don't|does\s+not|doesn't|never|not|не|нет)\b/.test(
    na
  );
  const negB = /\b(do\s+not|don't|does\s+not|doesn't|never|not|не|нет)\b/.test(
    nb
  );
  if (negA !== negB) {
    const coreA = stripPolarity(na);
    const coreB = stripPolarity(nb);
    if (coreA && coreB) {
      const tokensA = topicTokens(coreA);
      const tokensB = topicTokens(coreB);
      let shared = 0;
      for (const t of tokensA) if (tokensB.has(t)) shared += 1;
      if (
        shared >= 1 ||
        coreA.includes(coreB) ||
        coreB.includes(coreA)
      ) {
        return true;
      }
    }
  }

  // Same domain different numeric / categorical claim
  if (a.domain && b.domain && a.domain === b.domain && na !== nb) {
    const numA = na.match(/-?\d+(?:[.,]\d+)?/);
    const numB = nb.match(/-?\d+(?:[.,]\d+)?/);
    if (numA && numB && numA[0] !== numB[0]) return true;
    // short mutually exclusive preference phrases
    if (na.length < 80 && nb.length < 80) {
      const tokensA = topicTokens(na);
      const tokensB = topicTokens(nb);
      let shared = 0;
      for (const t of tokensA) if (tokensB.has(t)) shared += 1;
      if (shared >= 1 && shared < Math.min(tokensA.size, tokensB.size)) {
        return true;
      }
    }
  }

  return false;
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
  ]);
  const set = new Set();
  for (const t of String(text ?? "")
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)) {
    if (t.length < 3 || stop.has(t)) continue;
    set.add(t);
  }
  return set;
}

function stablePair(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}
