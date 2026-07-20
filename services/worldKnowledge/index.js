/**
 * Public exports — World Knowledge Gateway + Telegram composition (D-028).
 */

export {
  WORLD_SOURCE_TYPES,
  PROVIDER_TRUST,
  createProviderResult,
  createWorldEvidence,
  isWorldProvider,
} from "./providerContracts.js";

export {
  WORLD_KNOWLEDGE_ERROR,
  createWorldKnowledgeError,
  sanitizeWorldError,
} from "./providerErrors.js";

export {
  validateProvider,
  validateProviderResult,
} from "./providerValidator.js";

export {
  stripMarkup,
  normalizeProviderResult,
  normalizeProviderResults,
} from "./providerNormalizer.js";

export { scoreProviderResult } from "./providerScorer.js";

export { rankWorldResults, dedupeResults } from "./providerRanker.js";

export { createInMemoryWorldCache } from "./providerCache.js";

export { createProviderManager } from "./providerManager.js";

export {
  createStaticProvider,
  createMockNewsProvider,
  createMockResearchProvider,
  createMockDocumentationProvider,
  registerDefaultMockProviders,
} from "./mockProviders.js";

export {
  createWorldKnowledgeGateway,
  createIsolatedWorldKnowledgeGateway,
} from "./worldKnowledgeGateway.js";

export {
  createWorldKnowledgeForTelegram,
  isWorldKnowledgeWiringEnabled,
  wrapShadowGateway,
  wrapGatewayTimeout,
} from "./worldKnowledgeFactory.js";

export {
  createOfficialFeedProvider,
  OFFICIAL_FEED_PROVIDER_ID,
} from "./providers/officialFeedProvider.js";

export {
  parseFeedXml,
  sanitizeFeedText,
} from "./providers/feedXmlParser.js";

export {
  assertFeedUrlAllowed,
  isAllowedFeedContentType,
  looksLikeHtmlDocument,
  rejectUserSuppliedFeedUrl,
} from "./providers/feedUrlGuard.js";
