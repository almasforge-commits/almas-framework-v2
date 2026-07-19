# Project State

## Completed

- Telegram adapter (long polling)
- YouTube ingestion pipeline (metadata → transcript → AI summary → Knowledge)
- Finance tracking (Supabase): expenses, income, balance, history, statistics, category/period breakdowns, analytics, undo-last-transaction
- Memory system with embeddings and vector search (Supabase)
- Tasks (basic create/list/complete, stored in the Memory table)
- Keyword-based Knowledge search
- Git & GitHub set up

## In Progress

- **Knowledge storage migration: local JSON → Supabase**
  - Supabase driver written (`providers/storage/supabaseKnowledgeDriver.js`)
  - Migration SQL written (`supabase/migrations/0001_create_knowledge_table.sql`) — **not yet applied**
  - Service layer (`knowledgeService.js`) already updated to use the new driver
  - Rollback path kept intact: JSON drivers and existing JSON knowledge files are untouched

- **Knowledge Chunks foundation (chunking + embeddings + pgvector, for chunk-based RAG)**
  - Migration SQL finalized (`supabase/migrations/0002_add_knowledge_chunks.sql`): `knowledge.raw_content`, `knowledge_chunks` table, HNSW cosine index, per-operation anon RLS policies, `match_knowledge_chunks` RPC — **not yet applied**
  - `core/utils/chunkText.js` — pure text-chunking utility (Cyrillic + English, paragraph/sentence-aware boundaries, no external dependency), covered by `scripts/test-chunk-text.js`
  - `services/ai/embeddingService.js` — additive `createEmbeddings()` batch helper alongside the existing `createEmbedding()`, covered by `scripts/test-embedding-batch.js`
  - `providers/storage/knowledgeChunkDriver.js` and `services/storage/knowledgeChunkService.js` — insert/delete/load/match chunk rows, and chunk+embed+replace orchestration, covered by `scripts/test-knowledge-chunk-service.js`
  - **Not yet wired into the YouTube pipeline, Telegram, or chatService.** This is a standalone, locally-tested foundation only — no live behavior has changed.

## Next

- Inspect/apply RLS + apply the Knowledge migration (`0001`) to Supabase
- Apply the Knowledge Chunks migration (`0002`) to Supabase
- Wire `raw_content` capture into the YouTube pipeline and `saveKnowledge()`
- Wire chunk+embed+persist into the YouTube route (additive call, after `saveKnowledge()`)
- Chunk-based RAG using `knowledge_chunks`, additive alongside the existing whole-document Knowledge search — not a replacement yet
- Unified RAG across Knowledge + Memory (replacing the two separate search systems)
- Dedicated `tasks` table (replacing the Memory-table workaround)
- Additional sources through the same Pipeline + Knowledge Engine: PDF, Website, Voice, Notes, Instagram transcripts
- Wire up the existing but unused Inbox classifier (`services/inbox/`)

## Future

- Health tracking
- Research agent
- Automation engine
- Multi-interface support (Web application, Voice, public API)
- Multi-user support
