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

- **config/** — Telegram bot client, static AI model config, `webapp.js`, `inbox.js` (Inbox flags), and `domainRegistry.js` (single source of truth for ALMAS domains).
- **core/** — pipeline engine (`Pipeline`, `PipelineLogger`), shared context factory, constants, small text/date utilities. Only the YouTube ingestion flow currently runs through a full pipeline: validate input → load video info → load transcript → AI summary → build knowledge.
- **providers/** — integration boundaries: OpenAI (`askAI`, embeddings), the Supabase client, JSON file drivers for legacy Knowledge storage (being replaced, see "Migration in progress" below), and `knowledgeChunkDriver.js` (Supabase I/O for `knowledge_chunks` — insert, delete-by-knowledge-id, load-by-knowledge-id, and the `match_knowledge_chunks` similarity-search RPC; not yet wired into any flow, see `PROJECT_STATE.md`).
- **services/** — … `inbox/` (Unified Inbox observation + Universal Extractor shadow candidates + hybrid AI router; legacy `inboxClassifier.js` unused), `context/` (Conversation Context store + Clarification Engine; in-memory pending drafts), `personalKnowledge/` (Personal Knowledge Engine foundation + shadow ingest), `reasoning/` (Reasoning Engine foundation; unwired), …
- **handlers/** — Telegram-facing routing. Currently one large message handler plus extracted route files (`financeRoute.js` for finance reads, `youtubeRoute.js` for YouTube ingestion, `voiceRoute.js` for voice transcription, `menuRoute.js` for the navigation menu — see "Navigation Menu" below) and `keyboards/mainMenu.js` (pure Telegram keyboard builders). Most domains (memory, knowledge, tasks, finance writes) are still routed inline in the main handler rather than in dedicated route files.

### Current Data Stores

- **Supabase**: `finance_transactions`, `memories` (+ `match_memories` RPC for vector similarity search).
- **JSON files** (`knowledge/youtube/*.json`): Knowledge storage — migration to Supabase is in progress (see `PROJECT_STATE.md`).

### Unified Inbox + Universal Extraction (shadow observation)

Target flow for all future sources:

```
Input source → Inbox item → normalization → deterministic / AI analysis
  → universal extraction (shadow) → information-kind classification
  → validation → existing execution ownership → domain services
  → Inbox lifecycle update → Telegram / Web response
```

Inbox is the **canonical audit and information-structuring layer**. It records what arrived, who sent it, how it was classified/extracted, and what executed or was skipped. It never creates Finance/Tasks/Memory/Knowledge (or Ideas/Health/Projects), never deletes data, and never sends Telegram messages. Existing routers and domain services remain authoritative.

**Domain Registry** (`config/domainRegistry.js`, see `docs/DOMAINS.md`) describes every ALMAS domain (`id`, flags, `futureTable`). Universal Extraction kinds, Inbox information kinds, and AI-router action-type membership are derived from it — feature modules must not hardcode parallel domain lists.

**Universal Extractor** (`services/inbox/universalExtractor.js`) is **shadow-only**: it splits one message into ordered structured candidate items (finance/task/idea/health/project/…), runs **Universal Entity Extraction** (`services/entities/*`) then **Universal Relationship Extraction** (`services/relationships/*`) to attach grounded links between existing entities/items, validates and sanitizes them, and stores the result on `inbox_items.metadata.universalExtraction` / `routing_decision.universalExtraction`. It does **not** execute new domains. Domain activation comes later, one kind at a time.

Pipeline: `Extraction → Entity Extraction → Relationship Extraction → Validator → Inbox`.

Runtime: Inbox observation is wired through `inboxObservation.js` (received → analysis → extraction → execution chain) but defaults remain `INBOX_ENABLED=false`, `INBOX_MODE=off` (zero writes until enabled). Migration `0003` is applied. Telegram replies and Finance/Task/Memory ownership are unchanged.

### Normalized Ingestion Contract

To let future sources (Instagram transcripts, PDF, Website, Voice, Notes) reuse the same shared pipeline steps, source-specific loader steps populate two generic fields on the pipeline context instead of source-specific ones:

- `context.transcript` — raw extracted text content, regardless of source (YouTube transcript, PDF text, page text, etc.).
- `context.metadata.source` — normalized metadata: `{ type, title, url, author, duration, extra }`. `type` identifies the source (`"youtube"` today); `duration` is an opaque, source-defined value (YouTube currently provides a pre-formatted string, not raw seconds); `extra` is reserved for source-specific fields that don't fit the shared shape.

Shared steps (`buildKnowledge`, `saveKnowledge`, chunking, embedding) read only from `context.transcript` and `context.metadata.source` — never from a source-specific shape. Today only `loadYouTubeInfo.js` populates this contract (mapping YouTube's `{ title, channel, duration }` into it); adding a new source means writing a new loader step that populates the same contract, with no changes required to `buildKnowledge.js` or anything downstream.

### Voice Input

Telegram voice messages (`handlers/routes/voiceRoute.js`) are transcribed via OpenAI (`services/ai/transcriptionService.js`, requesting Russian explicitly via the `language` parameter) and then routed through the exact same `routeText()` function typed text uses (`handlers/messageHandler.js`) — voice is not a separate code path for Finance/Memory/Tasks/Knowledge/Chat, only an additional input adapter in front of the same router.

### Personal Knowledge Engine (foundation)

Standalone library under `services/personalKnowledge/` (D-018). Classifies user-grounded text into a closed personal ontology, validates confidence, stores only verified personal facts in an injectable in-memory store, and exposes `retrieve()` over personal + optional read-only world adapters with provenance.

- Injectable bounded in-memory store (also exposed as `repositories/inMemoryPersonalKnowledgeRepository`); **durable path (D-024):** `SupabasePersonalKnowledgeRepository` behind the same repository interface. Engines take `deps.repository` / `deps.store` only — no Supabase imports in engine code.
- **Shadow ingest (D-019):** when Inbox observation records Universal Extraction, `personalKnowledgeObservation.js` may feed supported candidates into the engine (shadow only). Sanitized counts land in Inbox `metadata.personalKnowledge`. Default `PERSONAL_KNOWLEDGE_ENABLED=false` → no-op. Does not change Telegram replies or domain execution.
- World/general knowledge is rejected on personal ingest; world search never writes into the personal store.
- Domain Registry kinds may map into PK domains; this module is not a second global domain registry.
- Timeline is retrieval-oriented only — never stored as a write domain in v1.

### Reasoning Engine (foundation)

Standalone library under `services/reasoning/` (D-020). Derives evidence-backed **insights** and **recommendations** from personal facts already held by ALMAS.

- Deterministic rules only (no LLM). Never invents facts; world knowledge is never used as evidence.
- Insights require ≥2 supporting facts, confidence scoring, and validation; recommendations reference insights only.
- Injectable in-memory store (also `repositories/inMemoryReasoningRepository`); **durable path (D-024):** `SupabaseReasoningRepository` via DI (`deps.repository` / `deps.store`). Core engine stays independent of Inbox/Telegram/Supabase.
- **Shadow observation (D-021):** after PK shadow ingest, `reasoningObservation.js` loads actor-scoped personal facts, derives insights/recommendations in memory, and writes sanitized counts to Inbox `metadata.reasoning`. Enabled only when Inbox is active, PK is enabled, and `REASONING_ENABLED` + mode `shadow` (defaults off). No Telegram UX; no recommendation delivery; no migration.

### Answer Engine (orchestration architecture)

Library under `services/answer/` (D-022). Single orchestrator that **decides which existing services participate** in producing an evidence-based answer — it does not replace Clarification, Personal Knowledge, Reasoning, World adapter, or domain readers.

- Fixed retrieval order: Conversation Context → Personal Knowledge → Reasoning → World Knowledge → Domain readers (Finance / Tasks / Knowledge / Memory) → merge.
- Deterministic evidence ranking + conflict resolution (personal > domain > reasoning > world); never silently merges contradictions; world never overwrites personal; world hits keep provenance.
- Output contract: `answer`, `confidence`, `needsClarification`, `clarificationQuestion`, `sources`, `evidenceSummary`, optional `worldSources` / `conflicts`, flags, `execution: { type: "none" }`.
- Injectable deps only; no LLM / new AI pipeline; core library stays free of handler/execution writes.
- **World Knowledge integration (D-027):** optional `deps.worldKnowledgeGateway`; deterministic `decideWorldRetrieval` skips personal-only queries; personal always wins; world read-only with full provenance; conflicts expose both sides (`resolutionPolicy: personal_priority`).
- **Telegram World wiring (D-028):** `createWorldKnowledgeForTelegram` + `createTelegramAnswerEngineWithWorld` behind `WORLD_KNOWLEDGE_ENABLED` + `WORLD_KNOWLEDGE_MODE` (`off` / `shadow` / `active`, default off). Shadow audits without changing replies; active may use world evidence; failures/timeouts fall back safely. Mock providers not enabled unless explicitly allowed for tests.
- **Official feeds (D-029):** first real provider — allowlisted RSS/Atom only; default registry empty until curated; SSRF-hardened fetch.
- **Read-only Telegram path (D-023):** `handlers/routes/answerRoute.js` answers genuine information questions (`спроси` / `найди` / `вспомни` / open interrogatives) via Answer Engine. Execution, navigation, and exact commands keep existing handlers. AI Router ownership unchanged.

### Universal Knowledge Ingestion (D-025)

Library under `services/ingestion/` + `sourceAdapters/`. Every external source converts to one **Normalized Document**, then chunk → Universal Extraction → Entity → Relationship → optional Inbox observe → `KnowledgeRepository` (shadow by default).

- Adapters: YouTube (reuses existing info loader), PDF/DOCX (pre-extracted text; no new parsers), HTML, Web, Text, Markdown. Future stubs: Image OCR, Email, Calendar, WHOOP, Drive, Dropbox.
- Modes: `dry_run` / `shadow` (default) / `active`. No Telegram wiring; no Personal Knowledge auto-write; does not replace the existing YouTube route workflow.
- Chunker wraps `core/utils/chunkText` with stable ids + checksums; embeddings left null for a later milestone.

### World Knowledge Gateway (D-026 / D-027 / D-029)

Standalone library under `services/worldKnowledge/`. Single entry for external knowledge **providers** (pluggable). Never stores world facts as personal knowledge.

- Provider contract: `initialize` / `search` / `health` / `shutdown`; normalized results with provenance (provider, url, sourceType, confidence, language, publishedAt, retrievedAt).
- Gateway: register/unregister providers → search all → normalize → dedupe → score/rank → optional in-memory TTL cache. Defaults disabled (`WORLD_KNOWLEDGE_ENABLED` unset).
- **Official RSS/Atom provider (D-029):** allowlisted HTTPS feeds only (`config/worldKnowledgeFeeds.js`; default empty). No article scraping, no web search, no LLM. Registered by `createWorldKnowledgeForTelegram` when mode is shadow/active and ≥1 feed enabled.
- **Answer Engine (D-027 / D-028):** inject via `deps.worldKnowledgeGateway`; called only when `decideWorldRetrieval` says so; Telegram composition uses `createWorldKnowledgeForTelegram` (default-off). Falls back to legacy `searchWorld` / adapter when gateway absent. Distinct from the thin Personal Knowledge `worldKnowledgeAdapter` DI hook.

### Conversation Context + Clarification Engine

Thin multi-turn layer (`services/context/*`, `handlers/routes/clarificationRoute.js`) hooked in `routeText()` after the menu / meaningless-input fast paths and before AI-router / legacy domain writes:

- One pending clarification per `(actorKey, chatId)` in an injectable bounded in-memory store (TTL 15m; get/set/update/clear/expire; `requestKey` idempotency). No DB migration.
- Supported drafts only: incomplete `task_create`, `memory_save`, and incomplete finance (parsed amount but missing explicit currency and/or description).
- Field-based Russian questions (no LLM); finance asks currency then description, one field at a time.
- Cancel → `Операция отменена.`; expiry clears silently and continues normal routing; menu labels / meaningless short input / destructive phrases never satisfy a pending field.
- **Ask policy (D-017):** shadow → no user-visible AI/task/memory clarification; active → task/memory clarification allowed; incomplete finance clarification works in any `AI_ROUTER_MODE` (legacy finance ownership; AI executor never writes finance).
- Temporal follow-ups store `unresolvedTemporal` only (no ISO invent). Voice transcripts share the same path as text.

### Navigation Menu

A button-based main menu replaces the old plain-text "Пока я умею" fallback as the primary discovery UI, without changing any existing typed command, voice behavior, or Finance/Memory/Knowledge/Task business logic:

- **`handlers/keyboards/mainMenu.js`** — pure functions building the persistent `ReplyKeyboardMarkup` main menu (📚 Знания / 💡 Идеи / 📋 Задачи / 🚀 Проекты / 💰 Финансы / 🧠 Память / 🌐 Открыть ALMAS / ❓ Помощь) and the `InlineKeyboardMarkup`s used by each section. No Telegram/bot import — trivially unit-testable.
- **`handlers/routes/menuRoute.js`** — one `send*()` function per menu destination. Each reuses an existing, unmodified read function (`getAllKnowledge`, `getActiveTasks`/`getCompletedTasks`, `getBalance`/`getHistory`/`getStatistics`) to format its reply; no new storage or business logic.
- **`handlers/callbackHandler.js`** — `registerCallbackHandler()` (called once from `index.js`, alongside `registerMessageHandler()`) listens for `callback_query` events from inline buttons and dispatches on a fixed `callback_data` map (`menu:home`, `menu:knowledge:all`, `menu:knowledge:search`, `menu:tasks:done`, `menu:finance:history`, `menu:finance:stats`, `menu:memory:recall`, `menu:memory:search`). Always calls `answerCallbackQuery`, even on a handler failure (in which case it also sends a short generic error reply instead of leaving the user without a response).
- `routeText()` (`handlers/messageHandler.js`) intercepts the exact main-menu button labels (plus `/start` and `"меню"`) in a small dispatch table, checked first — before clarification, AI router, and Finance/Memory/Task/Knowledge commands. Unrecognized input now shows the main menu ("Не понял запрос. Выбери раздел в меню 👇") instead of the old long command list, which moved verbatim into `sendHelp()` (reachable via "❓ Помощь").
- **Stateless by design (menu only)**: buttons that would otherwise need free-text input (Knowledge/Memory search, Memory recall) do not introduce menu session state — they reply with the existing typed command to use (e.g. "Напиши: найди `<запрос>`"). Pending clarification state (D-017) is separate and never keyed off menu labels.
- **`config/webapp.js`** — `ALMAS_WEB_APP_URL` (must be `https://`, else ignored). When set, "🌐 Открыть ALMAS" becomes a real `web_app` button (opens client-side, no message sent to the bot); when unset (the current, untouched `.env`), it stays a plain button whose label `routeText()` intercepts to reply "Веб-интерфейс пока не подключён."

### Telegram Mini App (presentation layer)

`mini-app/` is a separate Vite + React + TypeScript client (Foundation v1). It is a **presentation shell** only:

- Navigates Home / Inbox / Finance / Tasks / More (+ Knowledge and placeholders).
- Uses `window.Telegram.WebApp` when available; works in browser preview without Telegram.
- Consumes a typed `apiClient` boundary; default `VITE_ALMAS_API_MODE=mock` uses `mockApi`; `live` uses `realApi` against the read-only HTTP API with `Authorization: tma <raw initData>` only.
- Must call the ALMAS backend HTTPS API — **direct privileged Supabase access from the Mini App is forbidden**.
- `initDataUnsafe` is UI personalization only; authenticated identity must be validated server-side from raw `initData`.
- Deployment and live `ALMAS_WEB_APP_URL` wiring are **not** completed; bot menu behavior is unchanged until a real HTTPS URL is set.

### Read-only Mini App API (`api/`)

Separate Express **HTTP** process (`npm run api` → `api/server.js`). Does **not** alter bot polling (`npm start` / `index.js`). TLS is expected at the deployment proxy.

- Auth (ALMAS convention, not an official Telegram HTTP requirement): `Authorization: tma <raw initData>`; official bot-token HMAC in `api/auth/validateInitData.js`; actor from signed `user.id` only. Generic `401 unauthorized` for all auth failures.
- Stable envelopes: `{ data }` / `{ data, meta }` / `{ error: { code, message } }`.
- GET only: `/api/health`, `/api/dashboard`, `/api/inbox`, `/api/finance/summary`, `/api/finance/transactions`, `/api/tasks`, `/api/knowledge`.
- Fail-closed actor scoping: Finance by `user_id`, Inbox by `actor_key` (independent of `INBOX_ENABLED`); Tasks/Knowledge return `[]` when ownership cannot be enforced. Dashboard uses only scoped readers.
- Application filters do **not** replace Supabase RLS; per-user RLS/ownership remains a future migration.
- DI via `createApp(deps)` / reader factories; covered by `scripts/test-api-*.js`. See `api/README.md`.

Before routing, a voice transcript must survive:

- **Transcript plausibility validation** (`core/utils/validateVoiceTranscript.js`, pure/deterministic — there is no numerical confidence score from the API to rely on): empty transcripts are rejected; a transcript whose letters are mostly a script other than Cyrillic or Latin (e.g. an unrelated-language ASR hallucination) is rejected; otherwise Cyrillic letters must not be a small minority of Cyrillic+Latin letters, so a handful of Latin brand names/URLs/currency codes inside an otherwise Russian sentence are accepted, while a mostly-Latin transcript is not. Rejected transcripts never reach `routeText()` or Memory — the user gets `"❌ Не удалось уверенно распознать речь. Попробуйте сказать ещё раз."` instead.
- **Destructive-command safety** — for voice input only, a small set of destructive text/finance phrases (delete-all-knowledge, delete-last-transaction) are blocked with `"⚠️ Опасные команды голосом пока не выполняются. Отправьте команду текстом."`, matched via normalized text (see below) so capitalization/punctuation/spacing never bypass the guard. Typed text is unaffected.

`core/utils/normalizeUserText.js` provides the two normalization levels used across this flow (never applied globally — only where matching/classification needs it): `normalizeUserText()` (whitespace/repeated-punctuation cleanup, case and digits preserved — used to normalize a transcript before validation) and `normalizeCommandText()` (adds lowercasing + trailing-punctuation stripping — used for exact command/safety matching, including the destructive-command guard and finance-query intent matching in `financeQueryParser.js`).

Spoken Russian number words in finance phrases (e.g. "сорок тысяч", "два миллиона пятьсот тысяч") are converted to digits by `services/finance/russianNumberParser.js` and consumed inside `financeParser.js`'s `parseFinanceMessage()` — only once a finance trigger word is already detected, so ordinary notes are never affected. Scope: units, teens, tens, hundreds, thousands, and millions; out of scope: billions and word-form fractions.

`services/storage/memoryFilter.js`'s `shouldSaveMemory()` is the single deterministic guard for "is this text eligible for automatic Memory saving?" — it recognizes destructive commands, finance queries/trigger words (parsed or not), search/chat/knowledge/task command prefixes, and YouTube URLs, so command-like input is never silently stored as a note even if its own parser fails partway through. It implements no business logic itself — it only calls the same parsers/detectors those features already use.

**Known limitation:** finance voice/text input still requires either digits or one of the supported Russian number-word forms above — general free-form number phrasing beyond that list is not understood.

### AI Intent Analyzer & Action Planner (Hybrid Router)

A hybrid pipeline that lets typed and voice messages be understood semantically (natural Russian/English/Kazakh/mixed input, speech-recognition mistakes, conversational phrasing, multiple intents per message) without removing the existing deterministic router (`routeText()` in `handlers/messageHandler.js`). It runs **alongside** `routeText()`, observing every message; it does not currently replace or gate anything `routeText()` does.

**Flow:** `normalize input → Tier 0 (deterministic) → Tier 1 (cheap AI) → escalation check → Tier 2 (medium AI) → Safety Validator → Action Executor → decision (logged)`.

**Model tiers** (`config/aiRouter.js`):

- **Tier 0 — no AI** (`services/inbox/deterministicIntentDetector.js`): reuses the exact same pure parsers `routeText()` already uses (`financeParser.js`, `financeQueryParser.js`, `isYouTubeLink()`, exact/prefix commands) to resolve clear cases — known URLs, exact commands, cleanly parsed finance — without spending a model call. A narrow heuristic detects when a cleanly-parsed finance phrase has a second action glued onto it (e.g. "...на кофе **и завтра купить** батарейки") and defers to AI instead of returning a partial answer.
- **Tier 1 — cheap analyzer** (`services/inbox/aiIntentAnalyzer.js`, default model `gpt-5-nano`): detects language, extracts one or more actions with confidence, and decides whether to ask for clarification or escalate.
- **Tier 2 — medium planner** (`services/inbox/actionPlanner.js`, default model `gpt-5-mini`): only called when `shouldEscalateToMediumTier()` is true. Multiple actions alone is **not** an escalation reason — a confident (every action's confidence `>= AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD`), structurally complete plan (every action shape-valid, every type-specific required entity present — e.g. `amount` for finance, `content` for task/memory, `query` for chat/search/knowledge) is accepted straight from Tier 1, however many actions it has. Escalation still happens for: a malformed/unknown-typed action, a missing required entity (never guessed), Tier 1's own explicit `needsClarification`/`shouldEscalate` signal (e.g. unresolved relative dates it can't safely reason about), low confidence on any action, or unusually long input. Called at most once per message. There is no Tier 3 in this milestone.

**Provider-neutral AI layer** (`providers/ai/`): `plannerProvider.js` defines the provider contract (`{ name, run({systemPrompt, userPrompt}, {model}) }`) plus a safe `createUnavailablePlannerProvider()`; `openaiPlannerProvider.js` is the only concrete implementation today, built on the existing `askAI()` (`providers/ai/openaiProvider.js`, made lazy-client-safe as part of this milestone) with a strict `json_schema` response shape — so a future Kimi-backed provider only needs to implement the same `run()` contract. Nothing in `providers/ai/` imports Telegram, Supabase, or any Finance/Memory/Tasks/Knowledge service.

**Contract** (`services/inbox/contracts.js` — single source of truth for the shape, shared by the detector, both AI tiers, and the validator):

```json
{
  "language": "ru | en | kk | mixed | unknown",
  "actions": [
    { "type": "finance_expense | finance_income | task_create | memory_save | knowledge_query | search | chat | system_command | unknown",
      "confidence": 0.0, "payload": {}, "requiresConfirmation": false }
  ],
  "needsClarification": false,
  "clarificationQuestion": null,
  "shouldEscalate": false,
  "reasonCode": "..."
}
```

`payload` uses a fixed slot set (`amount`, `currency`, `description`, `content`, `query`, `date`, `command`) rather than a fully dynamic shape, so the AI's JSON schema stays strict and the validator can drop anything unexpected.

**Safety boundary** (`services/inbox/actionValidator.js` — the only place that decides an AI-produced action is valid): rejects unknown action types; forces `requiresConfirmation: true` on destructive `system_command`s (`delete_all_knowledge`, `delete_last_transaction`) and rejects them outright when `inputSource: "voice"`; rejects finance actions with a missing amount or confidence below `AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD` (forcing clarification instead of guessing); deduplicates identical actions; caps the action list at `AI_ROUTER_MAX_ACTIONS`; preserves original action order; never invents a missing field. Every action — deterministic or AI-produced — passes through this same validator before it can ever reach the executor below.

**Action Executor** (`services/inbox/actionExecutor.js` — the *only* module in this whole pipeline allowed to call a domain-executing service; `providers/ai/*` and every other `services/inbox/*` module must not): takes the validator's output for one incoming message and, preserving order, decides per action whether to actually run it:

- Any action still marked `requiresConfirmation` is never executed (defense in depth — the validator already blocks these from being auto-run, this is a second guarantee at the execution boundary itself).
- When `AI_ROUTER_MODE !== "active"` (i.e. `shadow`), every action is recorded as `skipped_shadow_mode` — nothing is ever executed outside active mode.
- In `active` mode, only `type: "task_create"` and `type: "memory_save"` actually run — both persist through the existing `saveMemory()` (Tasks still live inside the `memories` table; `task_create` sets `metadata.memoryType: "task"` directly rather than re-deriving it via `memoryClassifier.js`'s keyword heuristics, since the AI already decided it's a task). Every other type (`finance_expense`/`finance_income`, `system_command`, `knowledge_query`, `search`, `chat`, `unknown`) is recorded as `skipped_finance_not_enabled` or `skipped_not_enabled` and never executed — deterministic Finance parsing remains the sole authority over money movement.
- Duplicate actions (same type + payload) within one call are executed only once (`skipped_duplicate`); a thrown domain-service error is caught and recorded as `domain_error` without stopping the remaining actions or crashing routing.
- Cross-call idempotency: keyed by `context.requestKey` from `core/utils/buildRequestKey.js` (Telegram `message_id` primary; short text-hash fallback only when `message_id` is missing). In-memory, bounded (~500 keys); a process restart resets the cache.
- Returns a unified `{ results, executedCount, skippedCount }`, attached to the decision as `decision.execution` / `decision.executedCount` / `decision.skippedCount` / `decision.executed`. The executor never imports Telegram/`bot.js` — only structured results leave this module.

**Execution ownership (active mode):** when `isAiRouterExecutionActive()` is true, `routeText()` AWAITS `decideRouting()` before any legacy Finance/Memory/delete side effect. `getExecutedOwnedActions(decision)` returns only `task_create`/`memory_save` rows with `execution[].executed === true` (never merely planned). Those owned executions:

1. Get a user-visible confirmation via `handlers/routes/aiExecutionRoute.js` (`✅ Задача сохранена` / `🧠 Запомнил.`) — the only Telegram rendering boundary for AI execution results.
2. Suppress the legacy generic Memory-save fallback for that message only.
3. Suppress the default "не понял запрос" menu fallback after a successful AI action.
4. Still allow deterministic Finance to run on mixed messages (`looksLikeFinanceAttempt` / finance query). Mixed-message Finance descriptions are cleaned by `stripTrailingActionClause()` so a trailing task clause (e.g. "и завтра купить батарейки") does not pollute the expense description.

If `decideRouting()` / the provider fails, ownership stays empty and every legacy branch runs unchanged. `executed: false` never blocks legacy Memory.

**Shadow-by-default (current state):** with `AI_ROUTER_MODE=shadow` in `.env` (unchanged), `routeText()` still uses fire-and-forget `observeMessage()` — not awaited, never executes, never sends AI confirmations or clarification questions. Active-mode ownership/confirmations and Clarification Engine asks are implemented and tested but not enabled live.

**Cost controls** (env-driven, `config/aiRouter.js`): `AI_ROUTER_ENABLED` (kill switch), `AI_ROUTER_MODE` (`off | shadow | active`, default `shadow`), `AI_ROUTER_CHEAP_MODEL` / `AI_ROUTER_MEDIUM_MODEL`, `AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD`, `AI_ROUTER_MAX_INPUT_CHARS`, `AI_ROUTER_MAX_ACTIONS`. Tier 0 always runs first; Tier 2 only runs on escalation; a Tier 1 provider failure falls back to a safe "needs clarification" decision rather than calling Tier 2.

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
