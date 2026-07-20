/**
 * Answer composer — deterministic answer from ranked evidence.
 * No LLM. Execution always none.
 */

import { createAnswerResult, SOURCE_TRUST } from "./answerContracts.js";
import { normalizeMemoryFactContent } from "../storage/memoryFilter.js";
import { dedupeEvidence } from "./evidenceDedupe.js";

function worldSourcesFrom(flags, ranked) {
  if (Array.isArray(flags.worldSources) && flags.worldSources.length) {
    return flags.worldSources.slice(0, 20);
  }
  return (ranked || [])
    .filter((e) => e.scope === "world")
    .map((e) => ({
      provider: e.provenance?.provider ?? null,
      url: e.provenance?.url ?? null,
      sourceType: e.provenance?.sourceType ?? null,
      confidence: e.confidence,
      language: e.provenance?.language ?? null,
      publishedAt: e.provenance?.publishedAt ?? null,
      retrievedAt: e.provenance?.retrievedAt ?? null,
      summary: e.summary,
    }))
    .slice(0, 20);
}

/**
 * @param {object} input
 * @param {object[]} input.rankedEvidence
 * @param {object[]} [input.conflicts]
 * @param {object} [input.flags]
 * @param {object} [input.plan]
 * @param {number} [input.minConfidence]
 */
export function composeAnswer(input = {}) {
  const ranked = Array.isArray(input.rankedEvidence)
    ? input.rankedEvidence
    : [];
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const flags = input.flags || {};
  const minConfidence = input.minConfidence ?? 0.55;
  const worldSources = worldSourcesFrom(flags, ranked);

  if (ranked.length === 0) {
    return createAnswerResult({
      answer: null,
      confidence: 0,
      needsClarification: true,
      clarificationQuestion: "Уточните вопрос — недостаточно данных.",
      missingFields: ["query_detail"],
      sources: [],
      evidenceSummary: {
        total: 0,
        byScope: {},
        topIds: [],
        conflictCount: 0,
      },
      usedDomains: flags.usedDomains || [],
      usedReasoning: Boolean(flags.usedReasoning),
      usedPersonalKnowledge: Boolean(flags.usedPersonalKnowledge),
      usedWorldKnowledge: Boolean(flags.usedWorldKnowledge),
      usedConversationContext: Boolean(flags.usedConversationContext),
      worldSources,
      conflicts,
    });
  }

  // Pending clarification context → ask rather than invent.
  const pending = ranked.find(
    (e) => e.source === "conversation_context" && e.reason === "pending_clarification"
  );
  if (pending && ranked.filter((e) => e.scope === "personal" || e.scope === "domain").length === 0) {
    const missing = String(pending.content || "")
      .split("|")
      .map((s) => s.trim())
      .find((s) => s.startsWith("missing:"));
    return createAnswerResult({
      answer: null,
      confidence: 0.3,
      needsClarification: true,
      clarificationQuestion: pending.summary || "Уточните недостающие поля.",
      missingFields: missing
        ? missing.replace(/^missing:/, "").split(",").filter(Boolean)
        : ["clarification"],
      sources: toSources(ranked.slice(0, 3)),
      evidenceSummary: buildSummary(ranked, conflicts),
      usedDomains: flags.usedDomains || [],
      usedReasoning: Boolean(flags.usedReasoning),
      usedPersonalKnowledge: Boolean(flags.usedPersonalKnowledge),
      usedWorldKnowledge: Boolean(flags.usedWorldKnowledge),
      usedConversationContext: true,
      worldSources,
      conflicts,
    });
  }

  const confidence = computeConfidence(ranked, conflicts);
  if (confidence < minConfidence) {
    return createAnswerResult({
      answer: null,
      confidence,
      needsClarification: true,
      clarificationQuestion:
        "Недостаточно надёжных данных. Уточните, что именно нужно?",
      missingFields: ["stronger_evidence"],
      sources: toSources(ranked.slice(0, 5)),
      evidenceSummary: buildSummary(ranked, conflicts),
      usedDomains: flags.usedDomains || [],
      usedReasoning: Boolean(flags.usedReasoning),
      usedPersonalKnowledge: Boolean(flags.usedPersonalKnowledge),
      usedWorldKnowledge: Boolean(flags.usedWorldKnowledge),
      usedConversationContext: Boolean(flags.usedConversationContext),
      worldSources,
      conflicts,
    });
  }

  // Prefer non-world, non-conflict-loser lines for the answer body.
  const preferred = dedupeAnswerLines(pickPreferredLines(ranked, conflicts));
  const answer = preferred
    .map((e) => formatAnswerLine(e.summary || e.content))
    .filter(Boolean)
    .slice(0, 5)
    .join("\n");

  return createAnswerResult({
    answer: answer || null,
    confidence,
    needsClarification: false,
    clarificationQuestion: null,
    missingFields: [],
    sources: toSources(ranked.slice(0, input.maxSources ?? 12)),
    evidenceSummary: buildSummary(ranked, conflicts),
    usedDomains: uniqueDomains(ranked, flags.usedDomains),
    usedReasoning: Boolean(flags.usedReasoning),
    usedPersonalKnowledge: Boolean(flags.usedPersonalKnowledge),
    usedWorldKnowledge: Boolean(flags.usedWorldKnowledge),
    usedConversationContext: Boolean(flags.usedConversationContext),
    worldSources,
    conflicts,
  });
}

/**
 * Deterministic confidence from ranked evidence.
 */
export function computeConfidence(ranked, conflicts = []) {
  if (!Array.isArray(ranked) || ranked.length === 0) return 0;

  const top = ranked.slice(0, 5);
  const avgConf =
    top.reduce((s, e) => s + (Number(e.confidence) || 0), 0) / top.length;
  const avgTrust =
    top.reduce((s, e) => s + (SOURCE_TRUST[e.source] ?? 0.5), 0) / top.length;
  const avgScore =
    top.reduce((s, e) => s + (Number(e.score) || 0), 0) / top.length;

  const scopes = new Set(top.map((e) => e.scope));
  const agreementBoost = scopes.has("personal") && scopes.size >= 2 ? 0.08 : 0;
  const personalBoost = scopes.has("personal") ? 0.1 : 0;
  const reasoningBoost = scopes.has("reasoning") ? 0.05 : 0;
  const conflictPenalty = Math.min(0.25, (conflicts.length || 0) * 0.08);
  const worldOnly =
    scopes.size === 1 && scopes.has("world") ? 0.15 : 0;

  const c =
    0.35 * avgConf +
    0.25 * avgTrust +
    0.25 * avgScore +
    personalBoost +
    reasoningBoost +
    agreementBoost -
    conflictPenalty -
    worldOnly;

  return Math.max(0, Math.min(1, Math.round(c * 1000) / 1000));
}

function pickPreferredLines(ranked, conflicts) {
  const loserIds = new Set();
  for (const c of conflicts) {
    // Prefer preferredId; mark the other as secondary for answer text.
    if (c.preferredId && c.leftId && c.rightId) {
      const other = c.preferredId === c.leftId ? c.rightId : c.leftId;
      loserIds.add(other);
    }
  }

  const primary = ranked.filter(
    (e) =>
      e.scope !== "world" &&
      !loserIds.has(e.id) &&
      e.source !== "conversation_context"
  );
  if (primary.length) return primary;

  // Fall back to any non-world, then world.
  const nonWorld = ranked.filter((e) => e.scope !== "world");
  return nonWorld.length ? nonWorld : ranked;
}

function dedupeAnswerLines(items) {
  return dedupeEvidence(items);
}

function formatAnswerLine(text) {
  const normalized = normalizeMemoryFactContent(text);
  if (!normalized) return "";
  // Avoid rendering leftover imperative wrappers from legacy rows.
  if (/^(запомни|запомнить|remember)\b/iu.test(normalized)) {
    return "";
  }
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function toSources(items) {
  return items.map((e) => ({
    source: e.source,
    scope: e.scope,
    domain: e.domain,
    confidence: e.confidence,
    factId: e.factId,
  }));
}

function buildSummary(ranked, conflicts) {
  const byScope = {};
  for (const e of ranked) {
    byScope[e.scope] = (byScope[e.scope] || 0) + 1;
  }
  return {
    total: ranked.length,
    byScope,
    topIds: ranked
      .slice(0, 10)
      .map((e) => e.id)
      .filter(Boolean),
    conflictCount: conflicts.length,
  };
}

function uniqueDomains(ranked, used) {
  const set = new Set(Array.isArray(used) ? used : []);
  for (const e of ranked) {
    if (e.domain) set.add(String(e.domain));
    if (e.scope === "domain" && e.source) set.add(e.source);
  }
  return [...set].slice(0, 32);
}
