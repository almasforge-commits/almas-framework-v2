# Data Model

Every entity that should exist in Supabase, split into **Existing** (real tables, verified against the code) and **Planned** (needed for the target architecture in `ARCHITECTURE.md`, not yet built).

## Existing

### `finance_transactions`

Purpose: expense/income ledger.

| Field | Notes |
|---|---|
| id | primary key |
| type | `expense` \| `income` |
| amount | numeric |
| currency | e.g. VND, USD, KZT, RUB, EUR |
| category | e.g. Продукты, Кафе, Транспорт (nullable for income) |
| description | free text |
| user_id | Telegram user id, as text |
| batch_id | groups multi-item entries so they can be deleted/undone together |
| created_at | timestamp |

### `memories`

Purpose: free-form fact/message memory with semantic search.

| Field | Notes |
|---|---|
| id | primary key |
| source | e.g. `telegram` |
| type | e.g. `message` |
| content | the stored text |
| metadata | jsonb — includes `memoryType`, `importance`, `status`, `tags`, `chatId`, `userId` |
| embedding | vector, used by the `match_memories` RPC |
| created_at | timestamp |

Known limitation: **Tasks currently live in this table**, filtered via `metadata->>memoryType = 'task'` and `metadata->>status`. See "Planned: tasks" below.

### `match_memories` (RPC)

Purpose: vector similarity search over `memories.embedding`. Called with `query_embedding`, `match_threshold`, `match_count`.

### `knowledge`

Purpose: structured knowledge extracted from any content source (currently YouTube only).

| Field | Notes |
|---|---|
| id | uuid, primary key |
| type | e.g. `youtube` |
| title | |
| summary | |
| key_points | jsonb array |
| tags | jsonb array |
| ideas | jsonb array |
| tasks | jsonb array (suggested actions extracted from the content — not the same as the `tasks` entity) |
| source | jsonb — url, author, duration, etc., shape depends on `type` |
| fingerprint | used for duplicate detection |
| status | e.g. `approved` |
| raw_content | nullable text — the full, unprocessed source content (e.g. a YouTube transcript) that `summary`/`key_points`/etc. were derived from. Added in `supabase/migrations/0002_add_knowledge_chunks.sql`, it's the input `chunkText()` splits for `knowledge_chunks`. |
| created_at / updated_at | timestamps |

Status: table designed in `supabase/migrations/0001_create_knowledge_table.sql`, **not yet applied**. The application code (`knowledgeService.js`, `supabaseKnowledgeDriver.js`) is already written against this schema; until the migration runs, Knowledge is still served from JSON files as a fallback data source in practice.

### `knowledge_chunks`

Purpose: chunked, embedded pieces of a Knowledge item's `raw_content`, for RAG.

| Field | Notes |
|---|---|
| id | uuid, primary key |
| knowledge_id | fk → `knowledge.id`, `on delete cascade` |
| chunk_index | order of this chunk within its Knowledge item; unique together with `knowledge_id` |
| content | chunk text, produced by `core/utils/chunkText.js` |
| token_count | rough heuristic estimate (~4 chars/token), not an exact tokenizer count |
| embedding | `vector(1536)` — dimension of OpenAI's `text-embedding-3-small`, the same model Memory already uses |
| created_at | timestamp |

RLS: enabled, with one policy per operation (`select`/`insert`/`update`/`delete`) granted to the `anon` role — no single `for all` policy. Mirrors the confirmed live RLS style already used on `knowledge`.

RPC: `match_knowledge_chunks(query_embedding, match_threshold, match_count)` — cosine similarity search over `knowledge_chunks.embedding` (HNSW index), joined with `knowledge` for title/type/source, so results can be cited back to their source item. `security invoker` (not `security definer`).

Status: designed and finalized in `supabase/migrations/0002_add_knowledge_chunks.sql`, **not yet applied**. Application code (`providers/storage/knowledgeChunkDriver.js`, `services/storage/knowledgeChunkService.js`) is written against this schema but is **not wired into the YouTube pipeline, Telegram, or chatService yet** — it exists as a standalone, tested foundation only. See `PROJECT_STATE.md`.

## Planned

### `tasks`

Purpose: dedicated task tracking, replacing the `memories`-table workaround.

| Field (proposed) | Notes |
|---|---|
| id | |
| user_id | |
| content | |
| status | e.g. `active`, `done` |
| due_at | nullable |
| source_knowledge_id | nullable fk — task originated from a Knowledge item |
| created_at / updated_at | |

### `health_logs`

Purpose: personal health tracking.

| Field (proposed) | Notes |
|---|---|
| id | |
| user_id | |
| metric | e.g. `sleep_hours`, `weight` |
| value | numeric |
| unit | |
| recorded_at | |

### `automation_rules`

Purpose: user-defined repeatable actions.

| Field (proposed) | Notes |
|---|---|
| id | |
| user_id | |
| trigger | condition description |
| action | what ALMAS should do |
| enabled | boolean |
| created_at | |

### `agent_runs`

Purpose: record of AI agent executions (e.g. the research agent).

| Field (proposed) | Notes |
|---|---|
| id | |
| agent_type | e.g. `research` |
| input | |
| output | |
| status | e.g. `pending`, `done`, `failed` |
| created_at | |

### `sources`

Purpose: raw uploaded/ingested files backing a Knowledge item (PDF, voice, image).

| Field (proposed) | Notes |
|---|---|
| id | |
| knowledge_id | fk |
| file_type | |
| storage_path | Supabase Storage path |
| hash | for dedup |
| created_at | |

### `users`

Purpose: needed once ALMAS supports more than one implicit Telegram user, and for the future Web/Voice/API interfaces.

| Field (proposed) | Notes |
|---|---|
| id | |
| telegram_id | nullable — not every future user arrives via Telegram |
| display_name | |
| created_at | |
