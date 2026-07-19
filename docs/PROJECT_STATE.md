# Project State

## Completed

- Telegram adapter (long polling)
- YouTube ingestion pipeline (metadata → transcript → AI summary → Knowledge)
- Finance tracking (Supabase): expenses, income, balance, history, statistics, category/period breakdowns, analytics, undo-last-transaction
- Memory system with embeddings and vector search (Supabase)
- Tasks (basic create/list/complete, stored in the Memory table)
- Keyword-based Knowledge search
- Git & GitHub set up
- **Knowledge Chunks foundation (chunking + embeddings + pgvector) — migration `0002` applied, wired live**
  - `knowledge.raw_content` captured from the YouTube transcript and persisted through `knowledgeService.js` / `supabaseKnowledgeDriver.js`
  - Chunks + embeddings built and stored in `knowledge_chunks` via `knowledgeChunkService.js` after every successful `saveKnowledge()` call
  - Chunk-based RAG (`match_knowledge_chunks`) answers Telegram knowledge questions first, with automatic fallback to the original whole-document search when no chunks are found or a step fails
  - Covered by `scripts/test-chunk-text.js`, `scripts/test-embedding-batch.js`, `scripts/test-knowledge-chunk-service.js`, `scripts/test-knowledge-chunk-chat.js`

## In Progress

- **Knowledge storage migration: local JSON → Supabase**
  - Supabase driver written (`providers/storage/supabaseKnowledgeDriver.js`)
  - Migration SQL written (`supabase/migrations/0001_create_knowledge_table.sql`) — **not yet applied**
  - Service layer (`knowledgeService.js`) already updated to use the new driver
  - Rollback path kept intact: JSON drivers and existing JSON knowledge files are untouched

- **Universal Knowledge Ingestion foundation (normalized ingestion contract)**
  - `core/pipeline/steps/loadYouTubeInfo.js` now populates a normalized `context.metadata.source` (`type`, `title`, `url`, `author`, `duration`, `extra`) instead of the YouTube-specific `context.metadata.video`
  - `core/pipeline/steps/buildKnowledge.js` reads only from `context.metadata.source` — it no longer knows it's building from a YouTube video, so any future source only needs to populate the same contract
  - Covered by `scripts/test-load-youtube-info.js` (new) and the updated `scripts/test-build-knowledge.js`
  - Telegram behavior, the saved Knowledge object shape, RAG, Memory, Finance, and the Supabase schema are all unchanged
  - This milestone only establishes the shared contract for the existing YouTube source — no new source (PDF, Website, Voice, Notes, Instagram) is implemented yet

## Next

- Inspect/apply RLS + apply the Knowledge migration (`0001`) to Supabase
- Implement additional source-specific loaders (PDF, Website, Voice, Notes, Instagram transcripts) that populate the same `context.metadata.source` contract and reuse the shared `buildKnowledge` → `saveKnowledge` → chunk/embed pipeline
- Unified RAG across Knowledge + Memory (replacing the two separate search systems)
- Dedicated `tasks` table (replacing the Memory-table workaround)
- Wire up the existing but unused Inbox classifier (`services/inbox/`)

## Future

- Health tracking
- Research agent
- Automation engine
- Multi-interface support (Web application, Voice, public API)
- Multi-user support
