# Roadmap

Development phases. Each phase has a goal, deliverables, and an exit criterion — the condition that means the phase is actually done, not just started.

## Phase 0 — Foundation ✅ Done

**Goal:** prove the core loop works end-to-end for one content type.

- ✅ Git & GitHub
- ✅ Telegram adapter
- ✅ YouTube ingestion pipeline (metadata → transcript → AI summary → Knowledge)
- ✅ Finance tracking (Supabase)
- ✅ Memory with embeddings (Supabase + vector search)
- ✅ Tasks (basic, via the Memory table)

**Exit criterion:** a user can send a YouTube link and get back structured knowledge; track expenses/income; save and recall a memory. All true today.

## Phase 1 — Unified Knowledge Layer 🟡 In Progress

**Goal:** one real source of truth for Knowledge, ready for RAG.

- 🟡 Migrate Knowledge storage from JSON files to Supabase (migration SQL written, service/driver code updated, migration not yet applied)
- ⬜ Knowledge chunking
- ⬜ Embeddings for Knowledge
- ⬜ Unified RAG across Knowledge + Memory (currently two separate search systems)

**Exit criterion:** Knowledge lives only in Supabase, is chunked and embedded, and a single retrieval layer answers questions using both Knowledge and Memory.

## Phase 2 — Personal Data Expansion ⬜ Next

**Goal:** ALMAS accepts more than YouTube links.

- ⬜ PDF ingestion through the pipeline
- ⬜ Voice ingestion through the pipeline
- ⬜ Website ingestion through the pipeline
- ⬜ Dedicated Tasks table (replacing the memory-table workaround)
- ⬜ Health tracking (basic logging)

**Exit criterion:** every supported content type flows through the same Pipeline shape; Tasks and Health are first-class entities in Supabase, not repurposed Memory rows.

## Phase 3 — Automation & Agents ⬜ Future

**Goal:** ALMAS starts acting, not just remembering.

- ⬜ Research agent
- ⬜ Automation engine (repeatable actions on the user's behalf)
- ⬜ Additional adapters (e.g. Instagram)

**Exit criterion:** at least one agent can complete a multi-step task autonomously, with an approval gate before anything that changes user data.

## Phase 4 — Multi-Interface ALMAS OS ⬜ Future

**Goal:** ALMAS is no longer "a Telegram bot."

- ⬜ Web application
- ⬜ Voice interface
- ⬜ Public API
- ⬜ VPS / Docker deployment

**Exit criterion:** the same core (Pipeline, Knowledge, RAG, Agents) is reachable from at least two interfaces without duplicated business logic.
