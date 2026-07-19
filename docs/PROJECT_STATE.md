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

## Next

- Apply the Knowledge migration to Supabase
- Knowledge chunking + embeddings
- Unified RAG across Knowledge + Memory (replacing the two separate search systems)
- Dedicated `tasks` table (replacing the Memory-table workaround)
- PDF / Voice / Website ingestion through the existing Pipeline pattern
- Wire up the existing but unused Inbox classifier (`services/inbox/`)

## Future

- Health tracking
- Research agent
- Automation engine
- Multi-interface support (Web application, Voice, public API)
- Multi-user support
