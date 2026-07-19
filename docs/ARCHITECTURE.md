# Architecture

This document describes the architecture as it exists today, and the target architecture ALMAS is moving toward. See `DECISIONS.md` for the accepted decisions this architecture must not contradict.

## Guiding Rules

- Telegram is an adapter, not the core (D-001).
- Core has no knowledge of Telegram, or of any specific interface (D-005).
- Business logic lives in Core/Services, never in a handler (D-006).
- The Pipeline is the primary mechanism for turning raw input into Knowledge (D-002).
- Repositories/drivers only save data — no business logic there (D-007).

## Current Architecture

```
Telegram
   ↓
Handlers / Routes        (Telegram-specific, thin)
   ↓
Services                 (business logic, interface-agnostic)
   ↓
Providers                (OpenAI, Supabase, JSON — integration boundaries)
   ↓
Storage
```

### Current Modules

- **config/** — Telegram bot client, static AI model config.
- **core/** — pipeline engine (`Pipeline`, `PipelineLogger`), shared context factory, constants, small text/date utilities. Only the YouTube ingestion flow currently runs through a full pipeline: validate input → load video info → load transcript → AI summary → build knowledge.
- **providers/** — integration boundaries: OpenAI (`askAI`, embeddings), the Supabase client, JSON file drivers for legacy Knowledge storage (being replaced, see "Migration in progress" below), and `knowledgeChunkDriver.js` (Supabase I/O for `knowledge_chunks` — insert, delete-by-knowledge-id, load-by-knowledge-id, and the `match_knowledge_chunks` similarity-search RPC; not yet wired into any flow, see `PROJECT_STATE.md`).
- **services/** — domain logic, grouped by responsibility: `ai/` (embeddings — single-text `createEmbedding()` plus a batch `createEmbeddings()` helper with bounded concurrency), `analysis/` (AI summarization + normalization), `chat/` (RAG-lite Q&A over Knowledge), `content/` (YouTube metadata + transcript), `finance/` (parsing, categorization, Supabase persistence), `inbox/` (content-type classifier — written but not yet wired into any flow), `search/` (keyword search over Knowledge), `storage/` (Knowledge, Memory, Task persistence, plus `knowledgeChunkService.js` — chunk + embed + replace/query knowledge chunks; not yet wired into any flow), `workflows/` (the YouTube pipeline assembly).
- **handlers/** — Telegram-facing routing. Currently one large message handler plus two extracted route files (`financeRoute.js` for finance reads, `youtubeRoute.js` for YouTube ingestion). Most domains (memory, knowledge, tasks, finance writes) are still routed inline in the main handler rather than in dedicated route files.

### Current Data Stores

- **Supabase**: `finance_transactions`, `memories` (+ `match_memories` RPC for vector similarity search).
- **JSON files** (`knowledge/youtube/*.json`): Knowledge storage — migration to Supabase is in progress (see `PROJECT_STATE.md`).

### Normalized Ingestion Contract

To let future sources (Instagram transcripts, PDF, Website, Voice, Notes) reuse the same shared pipeline steps, source-specific loader steps populate two generic fields on the pipeline context instead of source-specific ones:

- `context.transcript` — raw extracted text content, regardless of source (YouTube transcript, PDF text, page text, etc.).
- `context.metadata.source` — normalized metadata: `{ type, title, url, author, duration, extra }`. `type` identifies the source (`"youtube"` today); `duration` is an opaque, source-defined value (YouTube currently provides a pre-formatted string, not raw seconds); `extra` is reserved for source-specific fields that don't fit the shared shape.

Shared steps (`buildKnowledge`, `saveKnowledge`, chunking, embedding) read only from `context.transcript` and `context.metadata.source` — never from a source-specific shape. Today only `loadYouTubeInfo.js` populates this contract (mapping YouTube's `{ title, channel, duration }` into it); adding a new source means writing a new loader step that populates the same contract, with no changes required to `buildKnowledge.js` or anything downstream.

### Known Gaps vs. Target

- Only YouTube goes through a real Pipeline. Memory-saving and Finance-writing bypass the pipeline pattern and live directly in the Telegram handler.
- The Inbox classifier exists as code (`services/inbox/`) but nothing calls it yet.
- Knowledge search (keyword-based, over JSON/Supabase) and Memory search (vector-based, over Supabase) are two separate systems with no unified retrieval layer.
- Tasks are stored inside the generic `memories` table rather than as a first-class entity.

## Target Architecture

```
Telegram / Web / Voice        (interfaces — adapters only, no business logic)
        ↓
      Inbox                   (single entry point for anything not a recognized command)
        ↓
    Classifier                (detect content type: youtube / pdf / website / voice / note / task / idea)
        ↓
     Pipeline                 (validate → extract → analyze → structure)
        ↓
     Knowledge                (unified object, any source type)
        ↓
     Supabase                 (single source of truth: Knowledge, Memory, Finance, Tasks, Health, Automation)
        ↓
       RAG                    (retrieval across Knowledge + Memory, unified)
        ↓
      OpenAI                  (reasoning / generation)
        ↓
   Interface response         (back through the originating adapter)
```

### What Changes to Get There

1. Every content source — YouTube, Instagram transcripts, PDF, Website, Voice, and Notes — goes through the same Pipeline shape already proven for YouTube, feeding the same Knowledge Engine (chunking + embeddings + `knowledge_chunks`, see `DATA_MODEL.md`). No parallel per-source mechanisms.
2. The Inbox + Classifier pattern becomes the single entry point for free-form input, replacing today's long if/else chain in the message handler.
3. Knowledge moves fully into Supabase (in progress).
4. A single RAG layer serves both Knowledge and Memory, replacing the two disconnected search implementations.
5. Tasks get a dedicated table instead of reusing `memories`.
6. Web and Voice become additional adapters calling the same Core — no logic duplicated per interface.
7. An Agent layer (Research, Automation) sits on top of the same Core services, with explicit approval gates before any action that changes user data.
