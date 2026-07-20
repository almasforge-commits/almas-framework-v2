/**
 * Public exports — Universal Knowledge Ingestion (library).
 * Not wired to Telegram handlers in this milestone.
 */

export {
  SOURCE_TYPES,
  checksumText,
  detectLanguageHint,
  createNormalizedDocument,
  toPipelineSourceMetadata,
} from "./normalizedDocument.js";

export { chunkDocumentContent } from "./contentChunker.js";

export {
  createIngestionPipeline,
  createIsolatedIngestionPipeline,
} from "./ingestionPipeline.js";
