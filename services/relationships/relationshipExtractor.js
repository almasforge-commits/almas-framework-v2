import { createRelationship } from "./relationshipContracts.js";
import {
  validateRelationships,
  filterRelationshipsToExistingEntities,
} from "./relationshipValidator.js";
import { isKnownEntityType } from "../entities/entityContracts.js";

// Deterministic relationship extractor. Never invents entities — only
// connects grounded entity bags / co-occurring extracted items. No I/O.

function firstEntity(entities, type) {
  const bag = entities?.[type];
  return Array.isArray(bag) && bag.length ? bag[0] : null;
}

function allEntities(entities, type) {
  const bag = entities?.[type];
  return Array.isArray(bag) ? bag : [];
}

function pushRel(list, partial) {
  list.push(createRelationship(partial));
}

function looksLikeMeeting(text, item) {
  const t = String(text ?? "").toLowerCase();
  if (item?.kind === "event") return true;
  return /(?:встреч|meeting|созвон|call with|встреча с)/i.test(t);
}

/**
 * Builds within-item relationships from an item's own entity bag + text.
 * @param {object} item
 * @param {string} sourceText
 * @returns {object[]}
 */
export function extractRelationshipsForItem(item, sourceText = "") {
  const rels = [];
  const entities = item?.entities && typeof item.entities === "object" ? item.entities : {};
  const kind = item?.kind || "unknown";
  const text = `${sourceText}\n${item?.content ?? ""}`;

  // Finance / expense → company or person (paid_to)
  if (kind === "finance") {
    for (const company of allEntities(entities, "companies")) {
      pushRel(rels, {
        type: "paid_to",
        sourceKind: "finance",
        targetKind: "companies",
        confidence: 0.9,
        metadata: { targetValue: String(company), reason: "finance_company" },
      });
    }
    for (const person of allEntities(entities, "people")) {
      pushRel(rels, {
        type: "paid_to",
        sourceKind: "finance",
        targetKind: "people",
        confidence: 0.85,
        metadata: { targetValue: String(person), reason: "finance_person" },
      });
    }
  }

  // Task → project / company / person
  if (kind === "task") {
    const projectName =
      typeof entities.project === "string" && entities.project.trim()
        ? entities.project.trim()
        : null;
    if (projectName || /по\s+проекту|для\s+проекта|project\s*:/i.test(text)) {
      // Only if project entity/domain signal exists — prefer companies/brands/platforms as project proxies only when explicit project language
      if (projectName) {
        pushRel(rels, {
          type: "belongs_to",
          sourceKind: "task",
          targetKind: "project",
          confidence: 0.9,
          metadata: { targetValue: projectName, reason: "task_project_field" },
        });
      }
    }

    for (const person of allEntities(entities, "people")) {
      pushRel(rels, {
        type: "assigned_to",
        sourceKind: "task",
        targetKind: "people",
        confidence: 0.8,
        metadata: { targetValue: String(person), reason: "task_person" },
      });
    }

    for (const company of allEntities(entities, "companies")) {
      pushRel(rels, {
        type: "related_to",
        sourceKind: "task",
        targetKind: "companies",
        confidence: 0.75,
        metadata: { targetValue: String(company), reason: "task_company" },
      });
    }

    for (const brand of allEntities(entities, "brands")) {
      pushRel(rels, {
        type: "related_to",
        sourceKind: "task",
        targetKind: "brands",
        confidence: 0.75,
        metadata: { targetValue: String(brand), reason: "task_brand" },
      });
    }
  }

  // Meeting / event → person (participant)
  if (looksLikeMeeting(text, item)) {
    for (const person of allEntities(entities, "people")) {
      pushRel(rels, {
        type: "participant",
        sourceKind: item.kind === "event" ? "event" : "chat",
        targetKind: "people",
        confidence: 0.9,
        metadata: { targetValue: String(person), reason: "meeting_person" },
      });
    }
  }

  // Idea → knowledge / urls / documents
  if (kind === "idea") {
    for (const url of allEntities(entities, "urls")) {
      pushRel(rels, {
        type: "references",
        sourceKind: "idea",
        targetKind: "urls",
        confidence: 0.85,
        metadata: { targetValue: String(url), reason: "idea_url" },
      });
    }
    for (const doc of allEntities(entities, "documents")) {
      pushRel(rels, {
        type: "created_from",
        sourceKind: "idea",
        targetKind: "documents",
        confidence: 0.8,
        metadata: { targetValue: String(doc), reason: "idea_document" },
      });
    }
    if (/из\s+(?:видео|статьи|книги)|from\s+(?:video|article|book)|inspired/i.test(text)) {
      // about/inspired_by knowledge only when knowledge-ish entities exist
      const knowledgeHint =
        firstEntity(entities, "urls") ||
        firstEntity(entities, "documents") ||
        firstEntity(entities, "websites");
      if (knowledgeHint) {
        pushRel(rels, {
          type: "inspired_by",
          sourceKind: "idea",
          targetKind: "knowledge",
          confidence: 0.7,
          metadata: { targetValue: String(knowledgeHint), reason: "idea_knowledge_hint" },
        });
      }
    }
  }

  // Project updates → mentions of platforms/brands
  if (kind === "project") {
    for (const platform of allEntities(entities, "platforms")) {
      pushRel(rels, {
        type: "mentions",
        sourceKind: "project",
        targetKind: "platforms",
        confidence: 0.7,
        metadata: { targetValue: String(platform), reason: "project_platform" },
      });
    }
  }

  // Generic: any item mentioning people/companies when not already covered
  if (kind !== "finance" && kind !== "task" && !looksLikeMeeting(text, item)) {
    for (const person of allEntities(entities, "people")) {
      pushRel(rels, {
        type: "mentions",
        sourceKind: kind,
        targetKind: "people",
        confidence: 0.65,
        metadata: { targetValue: String(person), reason: "generic_person_mention" },
      });
    }
  }

  // about: explicit "про/about X" when X is a grounded entity value
  const aboutMatch = text.match(/\b(?:про|about)\s+([^\s,.;!?]{2,40})/i);
  if (aboutMatch?.[1]) {
    const token = aboutMatch[1];
    for (const type of Object.keys(entities)) {
      if (!isKnownEntityType(type)) continue;
      const hit = allEntities(entities, type).find(
        (v) => String(v).toLowerCase() === token.toLowerCase()
      );
      if (hit != null) {
        pushRel(rels, {
          type: "about",
          sourceKind: kind,
          targetKind: type,
          confidence: 0.8,
          metadata: { targetValue: String(hit), reason: "about_phrase" },
        });
        break;
      }
    }
  }

  return validateRelationships(rels);
}

/**
 * Cross-item relationships for co-occurring kinds in one message.
 * Only links items that already exist in the list.
 *
 * @param {object[]} items
 * @param {string} sourceText
 * @returns {Map<number, object[]>} relationships keyed by item index
 */
export function extractCrossItemRelationships(items, sourceText = "") {
  const byIndex = new Map();
  if (!Array.isArray(items) || items.length < 2) return byIndex;

  const list = items.map((item, index) => ({ ...item, index: item.index ?? index }));
  const text = String(sourceText ?? "");

  const projects = list.filter((i) => i.kind === "project");
  const finances = list.filter((i) => i.kind === "finance");
  const tasks = list.filter((i) => i.kind === "task");
  const ideas = list.filter((i) => i.kind === "idea");
  const knowledge = list.filter((i) => i.kind === "knowledge");

  function add(index, rel) {
    if (!byIndex.has(index)) byIndex.set(index, []);
    byIndex.get(index).push(rel);
  }

  // Finance → Project (same message)
  for (const finance of finances) {
    for (const project of projects) {
      add(
        finance.index,
        createRelationship({
          type: "related_to",
          sourceKind: "finance",
          targetKind: "project",
          confidence: 0.8,
          metadata: {
            targetItemIndex: project.index,
            targetValue: project.content || project.entities?.projectName || null,
            reason: "co_occurrence_finance_project",
          },
        })
      );
      // Explicit "по проекту" language boosts belongs_to
      if (/по\s+проекту|для\s+проекта|project\s+almas/i.test(text)) {
        add(
          finance.index,
          createRelationship({
            type: "belongs_to",
            sourceKind: "finance",
            targetKind: "project",
            confidence: 0.85,
            metadata: {
              targetItemIndex: project.index,
              reason: "finance_project_language",
            },
          })
        );
      }
    }
  }

  // Task → Project
  for (const task of tasks) {
    for (const project of projects) {
      add(
        task.index,
        createRelationship({
          type: "belongs_to",
          sourceKind: "task",
          targetKind: "project",
          confidence: 0.85,
          metadata: {
            targetItemIndex: project.index,
            targetValue: project.content || project.entities?.projectName || null,
            reason: "co_occurrence_task_project",
          },
        })
      );
    }
  }

  // Idea → Knowledge
  for (const idea of ideas) {
    for (const kn of knowledge) {
      add(
        idea.index,
        createRelationship({
          type: "inspired_by",
          sourceKind: "idea",
          targetKind: "knowledge",
          confidence: 0.8,
          metadata: {
            targetItemIndex: kn.index,
            targetValue: kn.content || null,
            reason: "co_occurrence_idea_knowledge",
          },
        })
      );
    }
  }

  return byIndex;
}

/**
 * Enriches extracted items with relationships. Does not mutate inputs.
 * Pipeline step after entity enrichment.
 *
 * @param {object[]} items
 * @param {string} sourceText
 * @returns {object[]}
 */
export function enrichExtractedItemsWithRelationships(items, sourceText = "") {
  if (!Array.isArray(items)) return [];

  const cross = extractCrossItemRelationships(items, sourceText);

  return items.map((item, index) => {
    const within = extractRelationshipsForItem(item, sourceText);
    const fromCross = cross.get(item.index ?? index) || [];
    const combined = validateRelationships([...within, ...fromCross]);
    const grounded = filterRelationshipsToExistingEntities(
      combined,
      item,
      items
    );

    return {
      ...item,
      relationships: grounded,
    };
  });
}
