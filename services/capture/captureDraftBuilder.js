/**
 * Build a normalized Capture draft from one message.
 * Reuses Universal Extraction + deterministic finance/idea/task/memory parsers.
 * Never writes to the database.
 */

import { parseFinanceMessage, looksLikeFinanceAttempt } from "../finance/financeParser.js";
import { parseFinanceMessages } from "../finance/financeMultiParser.js";
import {
  extractIdeaDeterministic,
  extractTaskDeterministic,
  extractUniversalInformation,
} from "../inbox/universalExtractor.js";
import { isStrongIdeaCapture } from "../ideas/ideaDetector.js";
import { extractLegacyMemorySaveContent } from "../storage/memoryFilter.js";
import {
  createCaptureAction,
  createCaptureDraft,
} from "./captureContracts.js";
import {
  dedupeSegments,
  splitSemanticSegments,
} from "./captureTranscript.js";
import { validateCaptureDraft } from "./validateCaptureDraft.js";

/**
 * Map a universal-extraction item → capture action.
 * @param {object} item
 * @returns {object|null}
 */
export function mapExtractionItemToCaptureAction(item) {
  if (!item || typeof item !== "object") return null;
  const kind = String(item.kind ?? "").toLowerCase();
  const entities =
    item.entities && typeof item.entities === "object" ? item.entities : {};
  const content = String(
    item.content || entities.title || entities.description || ""
  ).trim();
  const confidence =
    typeof item.confidence === "number" ? item.confidence : 0.7;

  if (kind === "finance") {
    const direction =
      entities.direction === "income" || entities.direction === "expense"
        ? entities.direction
        : null;
    if (!direction) return null;
    return createCaptureAction({
      type: direction === "income" ? "finance_income" : "finance_expense",
      content: content || entities.description || "",
      confidence,
      payload: {
        amount: entities.amount ?? null,
        currency: entities.currency ?? "VND",
        description: entities.description || content || "",
        category: entities.category || null,
        dateText: entities.dateText || item.temporal?.raw || null,
      },
      relations: item.relationships || [],
    });
  }

  if (kind === "task") {
    const title = String(entities.title || content).trim();
    if (!title) return null;
    return createCaptureAction({
      type: "task_create",
      content: title,
      confidence,
      payload: {
        content: title,
        dueDateText: entities.dueDateText || item.temporal?.raw || null,
        project: entities.project || null,
        priority: entities.priority || null,
      },
      relations: item.relationships || [],
    });
  }

  if (kind === "idea") {
    const text = String(entities.summary || entities.title || content).trim();
    if (!text) return null;
    return createCaptureAction({
      type: "idea_create",
      content: text,
      confidence,
      payload: {
        content: text,
        title: entities.title || null,
        tags: Array.isArray(entities.tags) ? entities.tags : [],
        relatedProject: entities.relatedProject || null,
      },
      relations: item.relationships || [],
    });
  }

  if (kind === "memory" || kind === "preference") {
    const text = content;
    if (!text) return null;
    return createCaptureAction({
      type: kind === "preference" ? "preference" : "memory_save",
      content: text,
      confidence,
      payload: { content: text },
      relations: item.relationships || [],
    });
  }

  if (kind === "knowledge") {
    if (!content) return null;
    return createCaptureAction({
      type: "knowledge_candidate",
      content,
      confidence,
      payload: {
        title: entities.title || null,
        summary: entities.summary || content,
      },
      relations: item.relationships || [],
    });
  }

  return null;
}

/**
 * Deterministic multi-entity draft (works offline / without AI).
 * @param {string} text
 * @returns {object}
 */
export function buildDeterministicCaptureDraft(text) {
  const original = String(text ?? "").trim();
  if (!original) return createCaptureDraft({ actions: [] });

  const actions = [];
  const seen = new Set();

  function push(action) {
    if (!action) return;
    const cleaned = {
      ...action,
      content: tidyContent(action.content),
      payload: {
        ...action.payload,
        description: tidyContent(
          action.payload?.description ?? action.content
        ),
        content: tidyContent(action.payload?.content ?? action.content),
      },
    };
    if (!cleaned.content && cleaned.payload?.amount == null) return;

    // Strong finance dedupe: same direction + amount (+ similar description).
    if (
      cleaned.type === "finance_expense" ||
      cleaned.type === "finance_income"
    ) {
      const amount = Number(cleaned.payload?.amount);
      const dup = actions.find(
        (a) =>
          a.type === cleaned.type &&
          Number(a.payload?.amount) === amount &&
          Number.isFinite(amount)
      );
      if (dup) {
        // Keep the cleaner / shorter description.
        if (
          (cleaned.content || "").length > 0 &&
          ((dup.content || "").length === 0 ||
            cleaned.content.length < dup.content.length)
        ) {
          dup.content = cleaned.content;
          dup.payload = { ...dup.payload, ...cleaned.payload };
        }
        return;
      }
    }

    const sig = `${cleaned.type}|${String(cleaned.content)
      .toLowerCase()
      .slice(0, 80)}|${cleaned.payload?.amount ?? ""}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    actions.push(cleaned);
  }

  const segments = dedupeSegments(splitSemanticSegments(original));

  // Finance: prefer per-segment parse (correct expense vs income).
  // Amount-only follow-ups inherit the previous finance direction.
  let financeFromSegments = 0;
  let lastFinanceDirection = null;
  for (const segment of segments) {
    const cleanedSeg = stripLeadingConjunction(segment);

    // Multi-amount segment ("75 тысяч, 25 тысяч и 300 тысяч") before single parse.
    const multiSeg = parseFinanceMessages(cleanedSeg);
    if (multiSeg.length > 1) {
      for (const op of multiSeg) {
        lastFinanceDirection = op.type;
        financeFromSegments += 1;
        push(
          createCaptureAction({
            type: op.type === "income" ? "finance_income" : "finance_expense",
            content: op.description || "",
            confidence: 0.9,
            payload: {
              amount: op.amount,
              currency: op.currency || "VND",
              description: op.description || "",
              category: op.category || null,
            },
          })
        );
      }
      continue;
    }

    let fin = parseFinanceMessage(cleanedSeg);
    if (!fin && lastFinanceDirection) {
      fin = parseFinanceMessage(
        lastFinanceDirection === "income"
          ? `получил ${cleanedSeg}`
          : `потратил ${cleanedSeg}`
      );
    }
    // Bare money fragments ("75 тысяч", "300к") default to expense.
    if (!fin && looksLikeFinanceAttempt(cleanedSeg)) {
      fin = parseFinanceMessage(`потратил ${cleanedSeg}`);
    }
    if (!fin) continue;
    lastFinanceDirection = fin.type;
    financeFromSegments += 1;
    push(
      createCaptureAction({
        type: fin.type === "income" ? "finance_income" : "finance_expense",
        content: fin.description || "",
        confidence: 0.95,
        payload: {
          amount: fin.amount,
          currency: fin.currency || "VND",
          description: fin.description || "",
          category: fin.category || null,
        },
      })
    );
  }

  // Fallback multi-parser only when segment pass found no finance at all.
  if (financeFromSegments === 0) {
    const multi = parseFinanceMessages(original);
    if (multi.length > 0) {
      for (const op of multi) {
        push(
          createCaptureAction({
            type: op.type === "income" ? "finance_income" : "finance_expense",
            content: op.description || "",
            confidence: 0.9,
            payload: {
              amount: op.amount,
              currency: op.currency || "VND",
              description: op.description || "",
              category: op.category || null,
            },
          })
        );
      }
    } else {
      const single = parseFinanceMessage(original);
      if (single) {
        push(
          createCaptureAction({
            type:
              single.type === "income" ? "finance_income" : "finance_expense",
            content: single.description || "",
            confidence: 0.95,
            payload: {
              amount: single.amount,
              currency: single.currency || "VND",
              description: single.description || "",
              category: single.category || null,
            },
          })
        );
      }
    }
  }

  for (const segment of segments) {
    const cleanedSeg = stripLeadingConjunction(segment);

    // Skip segments that are finance (already captured) — never reclassify as Idea.
    if (parseFinanceMessage(cleanedSeg) || looksLikeFinanceAttempt(cleanedSeg)) {
      continue;
    }

    const ideaItem = extractIdeaDeterministic(cleanedSeg);
    if (ideaItem) {
      push(mapExtractionItemToCaptureAction(ideaItem));
    } else if (isStrongIdeaCapture(cleanedSeg)) {
      const ideaText = cleanedSeg
        .replace(
          /^(есть\s+идея|у\s+меня\s+идея|пришла\s+идея|появилась\s+идея|появилась\s+мысль|идея)\s*[:：]?\s*/iu,
          ""
        )
        .trim();
      push(
        createCaptureAction({
          type: "idea_create",
          content: ideaText || cleanedSeg,
          confidence: 0.85,
          payload: { content: ideaText || cleanedSeg },
        })
      );
    }

    const task = extractTaskDeterministic(cleanedSeg);
    if (task) {
      push(mapExtractionItemToCaptureAction(task));
    }

    const memoryCmd = extractLegacyMemorySaveContent(cleanedSeg);
    if (memoryCmd.kind === "save" && memoryCmd.content) {
      push(
        createCaptureAction({
          type: /нрав|предпочит|like|prefer/i.test(memoryCmd.content)
            ? "preference"
            : "memory_save",
          content: memoryCmd.content,
          confidence: 0.95,
          payload: { content: memoryCmd.content },
        })
      );
    } else if (
      /мне нравится|я люблю|предпочитаю|i like|i prefer/i.test(cleanedSeg)
    ) {
      const fact = cleanedSeg.replace(/^(кстати\s*,?\s*)/i, "").trim();
      if (fact) {
        push(
          createCaptureAction({
            type: "preference",
            content: capitalize(fact),
            confidence: 0.8,
            payload: { content: capitalize(fact) },
          })
        );
      }
    }

    if (
      !task &&
      /(?:напомни|не забыть|надо не забыть|reminder)/i.test(cleanedSeg)
    ) {
      const content = cleanedSeg
        .replace(/напомни(?:ть)?\s*(мне\s+)?/i, "")
        .replace(/надо\s+не\s+забыть\s*/i, "")
        .trim();
      if (content) {
        push(
          createCaptureAction({
            type: "reminder",
            content,
            confidence: 0.75,
            payload: { content },
          })
        );
      }
    }
  }

  const draft = createCaptureDraft({
    actions,
    sourceTier: "deterministic",
    language: "ru",
  });
  const financeCount = actions.filter(
    (a) => a.type === "finance_expense" || a.type === "finance_income"
  ).length;
  console.log(`[capture] deterministicFinance=${financeCount}`);
  return validateCaptureDraft(draft, {
    log: (line) => console.log(line),
  }).draft;
}

function stripLeadingConjunction(segment) {
  return String(segment ?? "")
    .replace(/^(и|а|но|потом|затем|also|and|then)\s+/iu, "")
    .trim();
}

function tidyContent(value) {
  return String(value ?? "")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build draft: deterministic first; optionally enrich with Universal Extraction.
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildCaptureDraft(text, options = {}) {
  const {
    useUniversalExtraction = false,
    extractUniversalFn = extractUniversalInformation,
    inputSource = "text",
  } = options;

  const deterministic = buildDeterministicCaptureDraft(text);

  if (!useUniversalExtraction) {
    return deterministic;
  }

  try {
    const extraction = await extractUniversalFn(text, {
      allowDefaultProvider: options.allowDefaultProvider === true,
      forceAi: options.forceAi === true,
      inputSource,
      maxItems: options.maxItems ?? 20,
    });

    const fromAi = (extraction?.items || [])
      .map(mapExtractionItemToCaptureAction)
      .filter(Boolean);

    if (!fromAi.length) return deterministic;

    const aiFinance = fromAi.filter(
      (a) => a.type === "finance_expense" || a.type === "finance_income"
    ).length;
    console.log(`[capture] aiFinance=${aiFinance}`);

    // Prefer richer AI split when it finds more (or equal with finance detail).
    // Never append duplicate finance from the same amount/identity.
    const mergedRaw = createCaptureDraft({
      actions: mergeActions(deterministic.actions, fromAi),
      sourceTier: extraction?.tier || "mixed",
      language: extraction?.language || deterministic.language,
      truncated: Boolean(extraction?.truncated),
    });
    const validated = validateCaptureDraft(mergedRaw, {
      log: (line) => console.log(line),
    });
    const mergedFinance = validated.draft.actions.filter(
      (a) => a.type === "finance_expense" || a.type === "finance_income"
    ).length;
    console.log(`[capture] mergedFinance=${mergedFinance}`);
    if (validated.removedDuplicates > 0) {
      console.log(
        `[capture] removedDuplicates=${validated.removedDuplicates}`
      );
    }
    return validated.draft;
  } catch (error) {
    console.error("[capture] universal extraction failed:", error?.message || error);
    return deterministic;
  }
}

/**
 * @param {object[]} base
 * @param {object[]} extra
 * @returns {object[]}
 */
function mergeActions(base, extra) {
  const out = [];
  const seen = new Set();
  const financeAmounts = new Set();

  function pushMerged(action) {
    if (!action) return;
    if (
      action.type === "idea_create" &&
      looksLikeFinanceAttempt(
        action.content || action.payload?.content || ""
      )
    ) {
      return;
    }
    if (
      (action.type === "finance_expense" || action.type === "finance_income") &&
      Number.isFinite(Number(action.payload?.amount)) &&
      financeAmounts.has(Number(action.payload.amount))
    ) {
      return;
    }
    const sig = `${action.type}|${String(action.content)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 100)}|${action.payload?.amount ?? ""}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(action);
    if (
      action.type === "finance_expense" ||
      action.type === "finance_income"
    ) {
      const amount = Number(action.payload?.amount);
      if (Number.isFinite(amount)) financeAmounts.add(amount);
    }
  }

  // Deterministic first so Confirm never reclassifies finance as idea via AI.
  for (const action of base || []) pushMerged(action);
  for (const action of extra || []) pushMerged(action);
  return out;
}
