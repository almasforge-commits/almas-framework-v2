/**
 * Universal Knowledge Ingestion Pipeline.
 * Raw → Adapter → NormalizedDocument → Chunk → UE → Entity → Relationship
 * → optional Inbox observe → KnowledgeRepository (shadow/active).
 *
 * Does not modify Telegram, Answer Engine, or Personal Knowledge logic.
 */

import { getIngestionConfig } from "../../config/ingestion.js";
import {
  createNormalizedDocument,
  toPipelineSourceMetadata,
} from "./normalizedDocument.js";
import { chunkDocumentContent } from "./contentChunker.js";
import { getSourceAdapter } from "../../sourceAdapters/index.js";
import { extractUniversalInformation } from "../inbox/universalExtractor.js";
import { enrichExtractedItemsWithEntities } from "../entities/entityExtractor.js";
import { enrichExtractedItemsWithRelationships } from "../relationships/relationshipExtractor.js";
import { createInMemoryKnowledgeRepository } from "../../repositories/inMemoryKnowledgeRepository.js";

/**
 * @param {object} [deps] — all collaborators injectable
 */
export function createIngestionPipeline(deps = {}) {
  const config =
    deps.config ?? getIngestionConfig(deps.env ?? process.env);

  const knowledgeRepository =
    deps.knowledgeRepository ?? createInMemoryKnowledgeRepository();

  const extractUniversalFn =
    deps.extractUniversalInformationFn ?? extractUniversalInformation;
  const enrichEntitiesFn =
    deps.enrichEntitiesFn ?? enrichExtractedItemsWithEntities;
  const enrichRelationshipsFn =
    deps.enrichRelationshipsFn ?? enrichExtractedItemsWithRelationships;
  const chunkFn = deps.chunkFn ?? chunkDocumentContent;
  const getAdapterFn = deps.getSourceAdapterFn ?? getSourceAdapter;
  const recordInboxFn =
    typeof deps.recordInboxObservationFn === "function"
      ? deps.recordInboxObservationFn
      : null;

  /**
   * Ingest a raw source payload.
   *
   * @param {object} input
   * @param {string} input.sourceType
   * @param {object} [input.raw] — adapter input
   * @param {object} [input.document] — pre-built normalized document
   * @param {string} [input.mode] — dry_run | shadow | active
   */
  async function ingest(input = {}) {
    const mode = input.mode || config.mode || "shadow";
    const startedAt = Date.now();

    let document =
      input.document && typeof input.document === "object"
        ? createNormalizedDocument(input.document)
        : null;

    if (!document) {
      const sourceType = String(input.sourceType || input.raw?.sourceType || "")
        .trim()
        .toLowerCase();
      const adapter = getAdapterFn(sourceType);
      if (!adapter) {
        return failureResult("unsupported_source_type", { sourceType, mode });
      }
      try {
        document = await Promise.resolve(
          adapter(input.raw || input, deps.adapterDeps || {})
        );
        document = createNormalizedDocument(document);
      } catch (error) {
        return failureResult(error?.code || error?.message || "adapter_failed", {
          mode,
          sourceType,
        });
      }
    }

    if (config.maxContentChars && document.content.length > config.maxContentChars) {
      document = createNormalizedDocument({
        ...document,
        content: document.content.slice(0, config.maxContentChars),
      });
    }

    const chunks = chunkFn(document.content, {
      documentId: document.id,
      chunkSize: input.chunkSize ?? config.chunkSize,
      chunkOverlap: input.chunkOverlap ?? config.chunkOverlap,
      language: document.language,
    });

    let extraction = null;
    let items = [];

    const runUe =
      input.runUniversalExtraction ?? config.runUniversalExtraction;
    if (runUe && document.content.trim()) {
      try {
        extraction = await extractUniversalFn(document.content, {
          allowDefaultProvider: false,
          maxItems: input.maxExtractionItems ?? 20,
          language: document.language,
          inputSource: "text",
          ...(deps.extractionOptions || {}),
        });
        items = Array.isArray(extraction?.items) ? extraction.items : [];

        if (input.runEntityExtraction ?? config.runEntityExtraction) {
          items = enrichEntitiesFn(items, document.content);
        }
        if (
          input.runRelationshipExtraction ?? config.runRelationshipExtraction
        ) {
          items = enrichRelationshipsFn(items, document.content);
        }
        if (extraction && typeof extraction === "object") {
          extraction = { ...extraction, items };
        }
      } catch {
        extraction = {
          items: [],
          reasonCode: "extraction_failed",
          tier: "none",
        };
        items = [];
      }
    }

    const provenance = {
      sourceType: document.sourceType,
      url: document.url,
      author: document.author,
      checksum: document.checksum,
      mimeType: document.metadata?.mimeType ?? null,
      language: document.language,
      chunkCount: chunks.length,
      originalSource: document.metadata?.originalSource ?? document.sourceType,
      pipelineSource: toPipelineSourceMetadata(document),
    };

    const knowledgeRecord = {
      id: document.id,
      title: document.title,
      type: document.sourceType,
      summary: input.summary ?? null,
      rawContent: document.content,
      source: {
        url: document.url,
        author: document.author,
        duration: document.metadata?.duration ?? null,
      },
      checksum: document.checksum,
      language: document.language,
      chunkCount: chunks.length,
      chunks: chunks.map((c) => ({
        id: c.id,
        index: c.index,
        checksum: c.checksum,
        tokenCount: c.tokenCount,
        content: c.content,
      })),
      extractionSummary: {
        itemCount: items.length,
        kinds: [...new Set(items.map((i) => i.kind).filter(Boolean))],
        tier: extraction?.tier ?? null,
        reasonCode: extraction?.reasonCode ?? null,
      },
      provenance,
      shadow: mode !== "active",
      mode,
      createdAt: document.createdAt,
      updatedAt: Date.now(),
    };

    let stored = null;
    let storageSkipped = true;

    if (mode === "dry_run") {
      storageSkipped = true;
    } else if (mode === "shadow" || mode === "active") {
      // Shadow: write only to injected repository (default in-memory).
      // Active: same API — caller must inject a durable repo; we never
      // call production knowledgeService from this module.
      storageSkipped = false;
      try {
        const result = await knowledgeRepository.upsert(knowledgeRecord);
        stored = result.record;
      } catch {
        return failureResult("knowledge_repository_failed", {
          mode,
          documentId: document.id,
          provenance,
        });
      }
    }

    if (recordInboxFn) {
      try {
        await recordInboxFn({
          mode,
          document,
          chunks,
          extraction,
          provenance,
        });
      } catch {
        // Inbox observation must never break ingestion.
      }
    }

    // Hard guarantee: this milestone never writes Personal Knowledge.
    const personalKnowledge = { attempted: false, written: false };

    return {
      ok: true,
      mode,
      document,
      chunks,
      extraction,
      items,
      provenance,
      knowledge: stored,
      storageSkipped,
      personalKnowledge,
      latencyMs: Date.now() - startedAt,
    };
  }

  return {
    ingest,
    config,
    knowledgeRepository,
  };
}

function failureResult(reason, extra = {}) {
  return {
    ok: false,
    reason: String(reason).slice(0, 120),
    document: null,
    chunks: [],
    extraction: null,
    items: [],
    knowledge: null,
    storageSkipped: true,
    personalKnowledge: { attempted: false, written: false },
    ...extra,
  };
}

export function createIsolatedIngestionPipeline(deps = {}) {
  return createIngestionPipeline({
    ...deps,
    knowledgeRepository:
      deps.knowledgeRepository ?? createInMemoryKnowledgeRepository(),
    env: deps.env ?? {},
  });
}
