/**
 * Idea capture orchestration — classify + persist + confirmation payload.
 * Used by AI executor and Telegram legacy capture path.
 */

import { classifyIdea } from "./ideaClassifier.js";
import { detectIdea } from "./ideaDetector.js";
import {
  IDEA_LOW_CONFIDENCE,
  normalizeIdeaCategory,
} from "./ideaContracts.js";
import { formatIdeaSaved } from "./ideaFormatters.js";
import { findRelatedIdeaIds, saveIdea } from "./ideaService.js";

/**
 * @param {object} input
 * @returns {Promise<{ ok: boolean, idea?: object, classification?: object, reason?: string }>}
 */
export async function captureIdea(input = {}) {
  const text = String(input.text ?? input.content ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };

  const detection = input.detection || detectIdea(text);

  const content =
    input.normalizedText || detection.content || text;

  const classification =
    input.classification ||
    (await classifyIdea(content, {
      skipAi: input.skipAi === true,
      lowConfidence: input.lowConfidenceThreshold ?? IDEA_LOW_CONFIDENCE,
    }));

  let persistedCategory = normalizeIdeaCategory(
    input.category || classification.category
  );
  if (classification.lowConfidence && !input.category) {
    persistedCategory = "other";
  }

  const confidence = Number(
    input.confidence ?? classification.confidence ?? detection.confidence ?? 0.5
  );

  const source = input.source || "text";
  const normalizedText = classification.normalizedText || content;

  let relatedIdeaIds = asIdArray(input.relatedIdeaIds);
  if (!relatedIdeaIds.length && input.actorKey && input.skipRelated !== true) {
    try {
      const related = await (input.findRelatedFn || findRelatedIdeaIds)(
        input.actorKey,
        normalizedText,
        { category: persistedCategory }
      );
      relatedIdeaIds = related.relatedIdeaIds || [];
    } catch {
      relatedIdeaIds = [];
    }
  }

  const idea = await saveIdea({
    actorKey: input.actorKey,
    telegramUserId: input.telegramUserId ?? input.userId,
    chatId: input.chatId,
    originalText: text,
    normalizedText,
    source,
    language: classification.language || "unknown",
    category: persistedCategory,
    confidence,
    tags: input.tags || classification.tags,
    relatedProjectIds: input.relatedProjectIds || [],
    relatedMemoryIds: input.relatedMemoryIds || [],
    relatedIdeaIds,
    metadata: {
      detectionReason: detection.reason || null,
      classificationSource: classification.source || null,
      relatedProject: classification.relatedProject || null,
      relatedMemoryHint: classification.relatedMemoryHint || null,
      lowConfidence: Boolean(classification.lowConfidence),
      origin: input.origin || "idea_capture",
      relatedIdeaIds,
    },
  });

  if (!idea) return { ok: false, reason: "persist_failed" };
  return { ok: true, idea, classification, detection };
}

/**
 * Telegram confirmation text + inline keyboard for category correction.
 * @param {object} idea
 * @returns {{ text: string, reply_markup: object }}
 */
export function buildIdeaConfirmationMessage(idea) {
  return formatIdeaSaved(idea);
}

function asIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).slice(0, 120)).filter(Boolean).slice(0, 20);
}
