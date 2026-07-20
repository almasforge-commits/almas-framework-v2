import {
  AI_ROUTER_CHEAP_MODEL,
  AI_ROUTER_MEDIUM_MODEL,
  AI_ROUTER_MAX_ACTIONS,
  AI_ROUTER_MAX_INPUT_CHARS,
  AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD,
} from "../../config/aiRouter.js";
import { normalizeForRouting } from "./inputNormalizer.js";
import { parseFinanceMessage } from "../finance/financeParser.js";
import {
  createExtractedItem,
  createExtractionResult,
  UNIVERSAL_EXTRACTION_JSON_SCHEMA,
  normalizeTransportEntities,
} from "./universalExtractionContracts.js";
import { validateExtractedItems } from "./universalExtractionValidator.js";
import { sanitizeUniversalExtraction } from "./universalExtractionSanitizer.js";
import { enrichExtractedItemsWithEntities } from "../entities/entityExtractor.js";
import { enrichExtractedItemsWithRelationships } from "../relationships/relationshipExtractor.js";

// Shadow-only Universal Information Extractor.
// Produces structured candidate items. Never executes domain actions.
// Never imports Telegram / Finance/Memory/Task/Knowledge services
// (financeParser is pure parsing only). Provider failure → empty/safe result.

const MULTI_PART_HINT =
  /(?:^|\s)и\s+(завтра|послезавтра|потом|ещё|также|напомни|нужно|купить|сделать|позвонить|написать|отправить|придумал|придумала|идея)(?:\s|$)/i;

const IDEA_PREFIX =
  /(?:^|[\s,.;:!?]|и\s+)(?:придумал(?:а|и)?|у\s+меня\s+идея|идея\s*[:：]|idea\s*[:：]|idea\s+for)\s+/i;

const TASK_HINT =
  /(?:^|[\s,.;:!?]|и\s+)(?:завтра|послезавтра|нужно|напомни|купить|сделать|позвонить|написать|отправить|todo|remind(?:er)?)\b/i;

const PROJECT_HINT =
  /(?:^|[\s,.;:!?])(?:проект\s*[:：]|проект\s+almas|по\s+проекту|project\s*[:：]|project\s+almas)/i;

function buildSystemPrompt(maxItems) {
  return `You extract independent information items from one personal-assistant message.
Languages: Russian, English, Kazakh, or mixed. Voice-transcription noise is possible.

Return JSON only. No chain-of-thought. No hidden reasoning. No prose.

Allowed kind values (exact): finance, task, memory, idea, health, knowledge, project, investment, news, contact, decision, goal, event, journal, chat, search, command, unknown.

Rules:
- Split into at most ${maxItems} independent items, preserving original order.
- Never invent amounts, currencies, dates, names, or numbers that are not in the text.
- If finance amount or currency is missing/unclear: still emit finance with requiresClarification=true and clarificationReason; leave amount/currency absent (do not guess).
- Finance entities: direction (expense|income), amount, currency, description, category, dateText.
- Task entities: title, dueDateText, project, priority. Put due hints like "завтра" in temporalRaw and entities.dueDateText.
- Idea entities: title, summary, tags, relatedProject.
- Health entities: metric, value, unit, secondaryValue (e.g. blood pressure 125/80).
- Project entities: projectName, update, statusHint.
- entities is a fixed object: unused scalar fields must be null; unused tags/entityExtras must be [].
- Put unknown leftover fields only in entityExtras as {key,value} rows (no free-form maps).
- confidence is 0..1. temporalRaw is a short date phrase from the text, or null.
- Do not invent domain writes. Extraction only.`;
}

function buildUserPrompt(normalizedText) {
  return `Message:\n"""\n${normalizedText}\n"""`;
}

function mapAiItem(raw) {
  return {
    kind: raw?.kind,
    content: raw?.content ?? "",
    confidence: raw?.confidence,
    entities: normalizeTransportEntities(raw?.entities),
    temporal: { raw: raw?.temporalRaw ?? null },
    requiresClarification: Boolean(raw?.requiresClarification),
    clarificationReason: raw?.clarificationReason ?? null,
  };
}

/**
 * Deterministic health extraction (narrow patterns).
 * @param {string} text
 * @returns {object[]}
 */
export function extractHealthDeterministic(text) {
  const items = [];
  const t = String(text ?? "");

  const weight = t.match(/(?:^|[\s,.;:!?])(?:вес|weight)\s+(\d+(?:[.,]\d+)?)(?:\s*(кг|kg))?/i);
  if (weight) {
    items.push(
      createExtractedItem({
        kind: "health",
        content: `weight ${weight[1]} ${weight[2] || "kg"}`.trim(),
        confidence: 0.95,
        entities: {
          metric: "weight",
          value: Number(weight[1].replace(",", ".")),
          unit: (weight[2] || "kg").toLowerCase(),
        },
      })
    );
  }

  const bp = t.match(
    /(?:^|[\s,.;:!?])(?:давление|blood\s+pressure)\s+(\d{2,3})\s*(?:на|\/)\s*(\d{2,3})/i
  );
  if (bp) {
    items.push(
      createExtractedItem({
        kind: "health",
        content: `blood_pressure ${bp[1]}/${bp[2]}`,
        confidence: 0.95,
        entities: {
          metric: "blood_pressure",
          value: Number(bp[1]),
          secondaryValue: Number(bp[2]),
          unit: "mmHg",
        },
      })
    );
  }

  const pulse = t.match(/(?:^|[\s,.;:!?])(?:пульс|pulse)\s+(\d{2,3})/i);
  if (pulse) {
    items.push(
      createExtractedItem({
        kind: "health",
        content: `pulse ${pulse[1]}`,
        confidence: 0.95,
        entities: { metric: "pulse", value: Number(pulse[1]), unit: "bpm" },
      })
    );
  }

  const steps = t.match(
    /(?:^|[\s,.;:!?])(?:прошёл|прошел|прошла)\s+(\d+)\s*шаг|(?:^|[\s,.;:!?])(\d+)\s*steps?\b/i
  );
  if (steps) {
    const value = Number(steps[1] || steps[2]);
    items.push(
      createExtractedItem({
        kind: "health",
        content: `steps ${value}`,
        confidence: 0.95,
        entities: { metric: "steps", value, unit: "steps" },
      })
    );
  }

  const sleep = t.match(
    /(?:^|[\s,.;:!?])(?:сон|sleep)\s+(\d+(?:[.,]\d+)?)(?:\s*(?:час(?:а|ов)?|h|hours?))?/i
  );
  if (sleep) {
    items.push(
      createExtractedItem({
        kind: "health",
        content: `sleep ${sleep[1]} hours`,
        confidence: 0.9,
        entities: {
          metric: "sleep",
          value: Number(sleep[1].replace(",", ".")),
          unit: "hours",
        },
      })
    );
  }

  return items;
}

/**
 * @param {string} text
 * @returns {object|null}
 */
export function extractIdeaDeterministic(text) {
  const t = String(text ?? "").trim();
  const m =
    t.match(/^\s*(?:идея\s*[:：]|idea\s*[:：]|idea\s+for)\s*(.+)$/i) ||
    t.match(/^\s*у\s+меня\s+идея\s*[:：]?\s*(.+)$/i) ||
    t.match(/(?:^|[\s,])придумал(?:а|и)?\s+(.+?)(?:\s+и\s+завтра|\s*$)/i);

  if (!m) return null;
  const content = String(m[1] ?? "").trim();
  if (!content) return null;

  return createExtractedItem({
    kind: "idea",
    content,
    confidence: 0.9,
    entities: { summary: content },
  });
}

/**
 * @param {string} text
 * @returns {object|null}
 */
export function extractProjectDeterministic(text) {
  const t = String(text ?? "").trim();
  const m =
    t.match(/^\s*проект\s*[:：]\s*(.+)$/i) ||
    t.match(/^\s*project\s*[:：]\s*(.+)$/i) ||
    t.match(/(?:проект|project)\s+(ALMAS)\s*[:：]?\s*(.*)$/i) ||
    t.match(/по\s+проекту\s+(ALMAS)\s*[:：]?\s*(.*)$/i);

  if (!m) return null;

  const projectName = m[1]?.toUpperCase?.() === "ALMAS" || /almas/i.test(m[0]) ? "ALMAS" : "project";
  const update = String(m[2] ?? m[1] ?? "").trim();
  if (!update && projectName === "project") return null;

  return createExtractedItem({
    kind: "project",
    content: update || projectName,
    confidence: 0.9,
    entities: {
      projectName: /almas/i.test(m[0]) ? "ALMAS" : typeof m[1] === "string" ? m[1].slice(0, 120) : null,
      update: update || null,
    },
  });
}

/**
 * @param {string} text
 * @returns {object|null}
 */
export function extractTaskDeterministic(text) {
  const t = String(text ?? "").trim();

  const tomorrow = t.match(
    /(?:^|[\s,.;:!?]|и\s+)завтра\s+(?:нужно\s+)?(.+?)(?:\s*$)/i
  );
  if (tomorrow) {
    const title = String(tomorrow[1] ?? "").trim();
    if (title) {
      return createExtractedItem({
        kind: "task",
        content: title,
        confidence: 0.9,
        entities: { title, dueDateText: "завтра" },
        temporal: { raw: "завтра" },
      });
    }
  }

  const buy = t.match(/^\s*(?:нужно\s+)?(?:купить|сделать|позвонить|написать|отправить)\s+(.+)$/i);
  if (buy) {
    const title = String(buy[0]).replace(/^\s*нужно\s+/i, "").trim();
    return createExtractedItem({
      kind: "task",
      content: title,
      confidence: 0.85,
      entities: { title },
    });
  }

  const en = t.match(/^\s*(?:remind(?:er)?(?:\s+me)?\s+to|todo[:\s]+)\s*(.+)$/i);
  if (en) {
    const title = String(en[1] ?? "").trim();
    if (title) {
      return createExtractedItem({
        kind: "task",
        content: title,
        confidence: 0.85,
        entities: { title },
      });
    }
  }

  return null;
}

/**
 * @param {string} text
 * @returns {object|null}
 */
export function extractFinanceDeterministic(text) {
  const parsed = parseFinanceMessage(text);
  if (!parsed) return null;

  return createExtractedItem({
    kind: "finance",
    content: parsed.description || "",
    confidence: 0.95,
    entities: {
      direction: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      description: parsed.description || "",
    },
  });
}

function looksMultiPart(text) {
  const t = String(text ?? "");
  if (MULTI_PART_HINT.test(t)) return true;
  const signals = [IDEA_PREFIX.test(t), TASK_HINT.test(t), PROJECT_HINT.test(t)];
  const finance = Boolean(parseFinanceMessage(t));
  const signalCount = signals.filter(Boolean).length + (finance ? 1 : 0);
  if (signalCount >= 2) return true;
  if ((t.match(/,/g) || []).length >= 2 && signalCount >= 1) return true;
  return false;
}

/**
 * Pure deterministic pass — may return 0..n items without AI.
 * @param {string} normalized
 * @returns {object[]}
 */
export function extractDeterministicItems(normalized) {
  const text = String(normalized ?? "").trim();
  if (!text) return [];

  // Multi-part messages: only collect clear non-overlapping deterministic
  // slices when AI is unavailable; prefer AI for true multi-intent splits.
  const health = extractHealthDeterministic(text);
  if (health.length && !looksMultiPart(text)) {
    return health;
  }

  if (!looksMultiPart(text)) {
    const finance = extractFinanceDeterministic(text);
    if (finance) return [finance];

    const idea = extractIdeaDeterministic(text);
    if (idea) return [idea];

    const project = extractProjectDeterministic(text);
    if (project) return [project];

    const task = extractTaskDeterministic(text);
    if (task) return [task];

    if (health.length) return health;
    return [];
  }

  // Multi-part: assemble what we can without guessing (finance on full
  // text often fails; leave splitting to AI). Still capture health-only
  // fragments if present.
  return health;
}

function averageConfidence(items) {
  if (!items.length) return 0;
  return items.reduce((s, i) => s + (i.confidence || 0), 0) / items.length;
}

function needsMediumTier(validated, cheapOk) {
  if (!cheapOk) return true;
  if (!validated.items.length) return true;
  if (validated.needsClarification) return true;
  if (averageConfidence(validated.items) < AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD) return true;
  return false;
}

async function runExtractionProvider(provider, normalized, model, maxItems) {
  if (!provider?.run) {
    return {
      ok: false,
      reason: "no_provider",
      retryable: false,
      result: null,
      usage: null,
    };
  }

  let response;
  try {
    response = await provider.run(
      {
        systemPrompt: buildSystemPrompt(maxItems),
        userPrompt: buildUserPrompt(normalized),
        jsonSchema: UNIVERSAL_EXTRACTION_JSON_SCHEMA,
      },
      { model }
    );
  } catch {
    return {
      ok: false,
      reason: "provider_threw",
      retryable: true,
      result: null,
      usage: null,
    };
  }

  if (!response?.ok || !response.result || !Array.isArray(response.result.items)) {
    return {
      ok: false,
      reason: response?.reason || "invalid_response",
      retryable: response?.retryable !== false,
      result: null,
      usage: response?.usage || null,
    };
  }

  return {
    ok: true,
    reason: null,
    retryable: true,
    result: response.result,
    usage: response.usage || null,
  };
}

function shouldRetryExtraction(providerResult) {
  if (!providerResult || providerResult.ok) return false;
  if (providerResult.retryable === false) return false;
  if (providerResult.reason === "invalid_json_schema") return false;
  return true;
}

function createLazyOpenAiExtractionProvider() {
  let loggedProviderError = false;
  return {
    name: "openai-extraction",
    async run({ systemPrompt, userPrompt, jsonSchema }, { model }) {
      const { askAI, classifyOpenAiError } = await import(
        "../../providers/ai/openaiProvider.js"
      );
      const startedAt = Date.now();
      try {
        const raw = await askAI(
          systemPrompt,
          userPrompt,
          jsonSchema || UNIVERSAL_EXTRACTION_JSON_SCHEMA,
          { model, throwClassified: true, logErrors: false }
        );
        if (!raw || typeof raw !== "object") {
          return {
            ok: false,
            result: null,
            reason: "invalid_response",
            retryable: true,
            usage: { model, latencyMs: Date.now() - startedAt },
          };
        }
        return {
          ok: true,
          result: raw,
          usage: { model, latencyMs: Date.now() - startedAt },
        };
      } catch (error) {
        const classified =
          error?.code && typeof error.retryable === "boolean"
            ? { code: error.code, retryable: error.retryable }
            : classifyOpenAiError(error);
        if (!loggedProviderError) {
          loggedProviderError = true;
          console.error(
            `[universal-extraction] provider_error code=${classified.code} retryable=${classified.retryable}`
          );
        }
        return {
          ok: false,
          result: null,
          reason: classified.code || "provider_error",
          retryable: classified.retryable !== false,
          usage: { model, latencyMs: Date.now() - startedAt },
        };
      }
    },
  };
}

function finalizeAndSanitize(items, sourceText, maxItems, meta) {
  const validated = validateExtractedItems(items, { maxItems });
  const withEntities = enrichExtractedItemsWithEntities(validated.items, sourceText);
  // Re-validate so universal entity bags pass through entitiesForKind merge.
  const entityValidated = validateExtractedItems(withEntities, { maxItems });
  const withRelationships = enrichExtractedItemsWithRelationships(
    entityValidated.items,
    sourceText
  );
  const finalItems = validateExtractedItems(withRelationships, { maxItems });
  return sanitizeUniversalExtraction(
    createExtractionResult({
      ...finalItems,
      ...meta,
      needsClarification:
        Boolean(meta.needsClarification) || finalItems.needsClarification,
    }),
    { maxItems }
  );
}

/**
 * Shadow-only universal extraction entry point.
 * Pipeline: Extraction → Entity Extraction → Relationship Extraction →
 * Validator → sanitize for Inbox.
 * Never throws. Provider failure returns a safe empty/partial result.
 *
 * @param {string} rawText
 * @param {object} [options]
 * @returns {Promise<object>} sanitized extraction result
 */
export async function extractUniversalInformation(rawText, options = {}) {
  const maxItems = options.maxItems ?? AI_ROUTER_MAX_ACTIONS;
  const maxChars = options.maxChars ?? AI_ROUTER_MAX_INPUT_CHARS;
  const cheapModel = options.cheapModel ?? AI_ROUTER_CHEAP_MODEL;
  const mediumModel = options.mediumModel ?? AI_ROUTER_MEDIUM_MODEL;
  const provider = options.provider ?? null;
  const allowDefaultProvider = options.allowDefaultProvider === true;

  const normalized = normalizeForRouting(rawText, {
    maxChars,
    inputSource: options.inputSource || "text",
  });

  try {
    const deterministic = extractDeterministicItems(normalized.normalized);
    const multi = looksMultiPart(normalized.normalized);

    if (deterministic.length && !multi && !options.forceAi) {
      return finalizeAndSanitize(deterministic, normalized.normalized, maxItems, {
        tier: "deterministic",
        reasonCode: "deterministic",
        language: options.language || "unknown",
      });
    }

    const activeProvider =
      provider || (allowDefaultProvider ? createLazyOpenAiExtractionProvider() : null);

    if (!activeProvider) {
      return finalizeAndSanitize(deterministic, normalized.normalized, maxItems, {
        tier: "deterministic",
        reasonCode: multi ? "multipart_no_provider" : "deterministic_only",
        language: options.language || "unknown",
        needsClarification: multi,
      });
    }

    let tier = "cheap";
    let cheap = await runExtractionProvider(
      activeProvider,
      normalized.normalized,
      cheapModel,
      maxItems
    );

    let rawItems = cheap.ok
      ? (cheap.result.items || []).map(mapAiItem)
      : deterministic.map((item) => ({ ...item }));

    let validated = validateExtractedItems(rawItems, { maxItems });

    if (needsMediumTier(validated, cheap.ok)) {
      const mayRetryProvider = cheap.ok || shouldRetryExtraction(cheap);
      if (mayRetryProvider) {
        const medium = await runExtractionProvider(
          activeProvider,
          normalized.normalized,
          mediumModel,
          maxItems
        );
        if (medium.ok) {
          tier = "medium";
          rawItems = (medium.result.items || []).map(mapAiItem);
          validated = validateExtractedItems(rawItems, { maxItems });
        } else if (!cheap.ok) {
          tier = "fallback";
          validated = validateExtractedItems(deterministic, { maxItems });
        }
      } else {
        // Deterministic schema/config errors must not hit a second model.
        tier = "fallback";
        validated = validateExtractedItems(deterministic, { maxItems });
      }
    }

    const language =
      (cheap.ok && cheap.result.language) || options.language || "unknown";

    return finalizeAndSanitize(validated.items, normalized.normalized, maxItems, {
      tier,
      reasonCode:
        (cheap.ok && cheap.result.reasonCode) ||
        (!cheap.ok ? `extraction_failed:${cheap.reason}` : "ok"),
      language,
      needsClarification: Boolean(cheap.ok && cheap.result.needsClarification),
    });
  } catch {
    return sanitizeUniversalExtraction(
      createExtractionResult({
        items: [],
        tier: "fallback",
        reasonCode: "extraction_threw",
        language: "unknown",
        needsClarification: false,
      }),
      { maxItems }
    );
  }
}
