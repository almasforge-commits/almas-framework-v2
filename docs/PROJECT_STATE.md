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

- **Voice-first command intelligence and routing safety**
  - Telegram voice messages are transcribed (`services/ai/transcriptionService.js`, Russian requested explicitly), validated for plausibility (`core/utils/validateVoiceTranscript.js` — rejects empty/wrong-script transcripts without a fake confidence score), and routed through the same `routeText()` as typed text (`handlers/routes/voiceRoute.js`, `handlers/messageHandler.js`)
  - Shared text normalization (`core/utils/normalizeUserText.js`) used only where matching/classification needs it — command matching, safety checks, and finance-query intent matching (`financeQueryParser.js` now normalizes before matching, fixing punctuated/uppercase voice variants of "удали последнюю операцию")
  - Spoken Russian number words in finance phrases ("сорок тысяч", "два миллиона пятьсот тысяч") are converted to digits (`services/finance/russianNumberParser.js`) and consumed inside `financeParser.js`, so e.g. "Потратил на кофе сорок тысяч" now parses as an expense of 40000 (previously failed and risked being saved as Memory)
  - `services/storage/memoryFilter.js`'s `shouldSaveMemory()` is now a comprehensive, deterministic Memory-eligibility guard covering destructive commands, finance/knowledge/search/chat/task commands, and YouTube URLs — independent of `routeText()`'s control flow
  - Covered by `scripts/test-normalize-user-text.js`, `scripts/test-validate-voice-transcript.js`, `scripts/test-russian-number-parser.js`, `scripts/test-finance-spoken-numbers.js`, `scripts/test-memory-routing-guard.js`, plus extended `scripts/test-transcription-service.js` / `scripts/test-voice-route.js`
  - Known limitation: finance input still requires digits or one of the supported Russian number-word forms — general free-form number phrasing beyond that list is not understood

- **AI Intent Analyzer & Action Planner (hybrid router) — shadow by default, active execution scoped to task_create/memory_save only**
  - New pipeline: `normalize → Tier 0 deterministic → Tier 1 cheap AI (gpt-5-nano) → escalation check → Tier 2 medium AI (gpt-5-mini) → Safety Validator → Action Executor`, running alongside (not replacing) the existing `routeText()` deterministic router
  - `services/inbox/contracts.js` (shared JSON contract + closed action-type enum), `services/inbox/inputNormalizer.js`, `services/inbox/deterministicIntentDetector.js` (Tier 0, reuses existing pure parsers), `services/inbox/aiIntentAnalyzer.js` (Tier 1), `services/inbox/actionPlanner.js` (Tier 2 escalation logic), `services/inbox/actionValidator.js` (deterministic safety layer — rejects unknown types, forces confirmation on destructive actions, blocks voice-destructive outright, rejects low-confidence/missing finance amounts, dedupes, caps, preserves order), `services/inbox/actionExecutor.js` (the ONLY module in this pipeline allowed to call a domain service), `services/inbox/routingDecisionService.js` (orchestrator)
  - Escalation is no longer triggered merely by having multiple actions: a confident (`>= AI_ROUTER_CHEAP_CONFIDENCE_THRESHOLD`), structurally complete multi-action plan from Tier 1 is accepted as-is. Tier 2 is used only for a malformed/unknown-shaped action, a missing required entity (never guessed), Tier 1's own `needsClarification`/`shouldEscalate` signal, low confidence on any action, or unusually long/context-dependent input (`services/inbox/actionPlanner.js`)
  - `services/inbox/actionExecutor.js`: executes validated actions for one incoming message, in order, never throwing. Whitelisted for real execution: `task_create` and `memory_save` only (both persist through the existing `saveMemory()`, since Tasks still live in the `memories` table) — every other type (`finance_*`, `system_command`/destructive, `knowledge_query`, `search`, `chat`, `unknown`) is always recorded as `skipped_finance_not_enabled`/`skipped_not_enabled`, never executed. Only runs when `mode === "active"`; in `shadow` mode every action is recorded as `skipped_shadow_mode`. Deduplicates identical actions within one call (`skipped_duplicate`) and never executes an action still marked `requiresConfirmation`. Cross-call idempotency via `requestKey` (`core/utils/buildRequestKey.js`: Telegram `message_id` primary, text-hash fallback); in-memory bounded cache resets on process restart. Never imports Telegram.
  - **Execution ownership + user-visible confirmations (active mode):** `routeText()` AWAITS `decideRouting()` when `isAiRouterExecutionActive()`; `getExecutedOwnedActions()` owns only actually-executed `task_create`/`memory_save`. Confirmations are rendered by `handlers/routes/aiExecutionRoute.js` (`✅ Задача сохранена` / `🧠 Запомнил.`). Legacy Memory and the default menu fallback are suppressed only when `execution[].executed === true`. Finance stays deterministic/legacy-owned; mixed messages still get both confirmations; `stripTrailingActionClause()` keeps finance descriptions clean. Provider/`decideRouting` failure → empty ownership → normal legacy behavior. Shadow mode still uses fire-and-forget `observeMessage()` and never sends AI confirmations.
  - Provider-neutral: `providers/ai/plannerProvider.js` (contract) + `providers/ai/openaiPlannerProvider.js` (OpenAI implementation, reuses `providers/ai/openaiProvider.js`, which was made lazy-client-safe so importing it never throws without `OPENAI_API_KEY`) — a future Kimi provider only needs to implement the same `run()` shape
  - `config/aiRouter.js`: `AI_ROUTER_ENABLED`, `AI_ROUTER_MODE` (`off|shadow|active`, defaults to `shadow`), `isAiRouterExecutionActive()`, model names, confidence threshold, input/action caps
  - `providers/storage/supabase.js` was made lazy (Proxy-wrapped, constructed on first real use) for the same reason `openaiProvider.js` was earlier — `actionExecutor.js` now transitively imports it, and importing the router pipeline must never crash a process without Supabase env vars (e.g. isolated tests); every existing `supabase.from(...)`/`supabase.rpc(...)` call site is unchanged
  - Covered by `scripts/test-ai-router-contracts.js`, `scripts/test-ai-router-config.js`, `scripts/test-planner-provider.js`, `scripts/test-input-normalizer.js`, `scripts/test-deterministic-intent-detector.js`, `scripts/test-ai-intent-analyzer.js`, `scripts/test-action-planner-tiers.js`, `scripts/test-action-validator.js`, `scripts/test-action-executor.js`, `scripts/test-routing-decision-service.js` (incl. ownership/confirmation/idempotency scenarios), `scripts/test-ai-execution-route.js`, `scripts/test-build-request-key.js`, `scripts/test-strip-trailing-action-clause.js`, `scripts/test-finance-description-cleanup.js`, plus extended `scripts/test-message-router-extraction.js`
  - `AI_ROUTER_MODE` remains `shadow` in `.env` — active ownership/confirmations are implemented and tested but not enabled live

- **Domain Registry (`config/domainRegistry.js`)**
  - Single source of truth for domain ids, flags (`extractable` / `executable` / search / timeline / AI), icons, and `futureTable`
  - Wired into Universal Extraction kinds, Inbox `INFORMATION_KINDS`, and AI-router `ACTION_TYPES` membership via `contracts.js` / `actionValidator.js`
  - Documented in `docs/DOMAINS.md`; covered by `scripts/test-domain-registry.js`
  - No Telegram, DB, execution, or `.env` behavior changes

- **Unified Inbox foundation + shadow observation wiring (disabled by default)**
  - Contracts / sanitizer / classifier / config / driver / service as before; migration `0003` **applied**
  - Runtime wrapper `services/inbox/inboxObservation.js`: per-`requestKey` ordered chain `received → analysis → universalExtraction → execution` (detached from Telegram reply timing)
  - **Universal Extractor** + **Entity Extraction** + **Relationship Extraction** (`services/entities/*`, `services/relationships/*`): shadow-only multi-item candidates with grounded entities and relationships; persists sanitized jsonb on Inbox; does **not** execute Idea/Health/Project/News/Investment
  - Pipeline: Extraction → Entity Extraction → Relationship Extraction → Validator → Inbox
  - Wired: `routeText` / `decideRouting` observation chain unchanged for Telegram replies; `voiceRoute.js` untouched
  - Defaults remain `INBOX_ENABLED=false` / `INBOX_MODE=off`; `.env` not modified
  - Covered by prior Inbox tests plus `scripts/test-inbox-observation.js`, `scripts/test-universal-extraction.js`, `scripts/test-entity-extraction.js`, `scripts/test-relationship-extraction.js`

- **Navigation menu (button-based main menu)**
  - Persistent `ReplyKeyboardMarkup` main menu (📚 Знания / 💡 Идеи / 📋 Задачи / 🚀 Проекты / 💰 Финансы / 🧠 Память / 🌐 Открыть ALMAS / ❓ Помощь) shown on `/start`, `"меню"`, and pressing "🏠 Главная"; also shown as the new fallback ("Не понял запрос. Выбери раздел в меню 👇") instead of the old long command-list text (which moved, byte-for-byte, into `sendHelp()`, reachable via "❓ Помощь")
  - `handlers/keyboards/mainMenu.js` (pure keyboard builders), `handlers/routes/menuRoute.js` (one `send*()` per section, reusing existing unmodified read functions only), `handlers/callbackHandler.js` (`registerCallbackHandler()`, wired in `index.js` next to `registerMessageHandler()`), `config/webapp.js` (`ALMAS_WEB_APP_URL`, unset by default, `.env` untouched)
  - Knowledge/Tasks/Finance/Memory sections show live data via `getAllKnowledge`/`getActiveTasks`+`getCompletedTasks`/`getBalance`+`getHistory`+`getStatistics` — no new storage or business logic
  - Stateless by design: Knowledge/Memory search and Memory recall buttons reply with the existing typed command to use (e.g. "Напиши: найди `<запрос>`") instead of introducing session state
  - Ideas and Projects are clean placeholders only ("раздел готовится")
  - Menu dispatch remains a separate exact-match block from AI ownership; AI confirmations never replace menu button handling
  - Covered by `scripts/test-main-menu-keyboards.js`, `scripts/test-menu-route.js`, `scripts/test-callback-handler.js`, plus extended `scripts/test-message-router-extraction.js`
  - Known limitation: "🌐 Открыть ALMAS" always shows "Веб-интерфейс пока не подключён." until `ALMAS_WEB_APP_URL` is set to a real `https://` URL

- **Telegram Mini App Foundation v1 (`mini-app/`)**
  - Separate Vite + React + TypeScript + Tailwind client; Home / Inbox / Finance / Tasks / Knowledge / More
  - Telegram WebApp bridge (`ready` / `expand` / theme / display user); browser preview without Telegram
  - Typed `apiClient` selects `mockApi` (default) or `realApi` (`VITE_ALMAS_API_MODE=live` + `VITE_ALMAS_API_URL`)
  - Live auth: raw `initData` only via `Authorization: tma …`; safe 401/503/network UI; no Supabase/bot secrets in client
  - Presentation layer only; not deployed; bot `.env` / `ALMAS_WEB_APP_URL` unchanged
  - See `mini-app/README.md`

- **Read-only Mini App API (`api/`)**
  - Separate Express HTTP entry (`npm run api`); bot polling (`npm start`) unchanged; `.env` not modified
  - Official bot-token HMAC for raw `initData`; generic 401; ALMAS `Authorization: tma …` convention
  - Envelopes `{ data }` / `{ data, meta }`; Inbox reads ignore `INBOX_ENABLED`; fail-closed Tasks/Knowledge
  - Application filters do not replace RLS (documented limitation)
  - Covered by `scripts/test-api-*.js` including `test-api-boundary.js`
  - Mini App client not wired yet (still mock); not deployed
  - See `api/README.md`

- **Conversation Context + Clarification Engine foundation (D-017)**
  - In-memory pending drafts per `(actorKey, chatId)`: `services/context/*` (TTL, update, requestKey idempotency)
  - Thin `routeText()` hook + `handlers/routes/clarificationRoute.js`
  - Completes incomplete `task_create` / `memory_save` / incomplete finance (currency→description; legacy writes)
  - Shadow: no AI/task/memory clarification UX; Active: task/memory asks; Finance clarify in any mode
  - Covered by `scripts/test-conversation-context.js`, `scripts/test-clarification-engine.js`, `scripts/test-clarification-routing-regressions.js`

- **Personal Knowledge Engine foundation (D-018)**
  - Library only: `services/personalKnowledge/*` + `config/personalKnowledge.js`
  - Closed personal ontology; deterministic RU/EN classifier; confidence validation; Personal vs World split
  - Injectable bounded in-memory store; `ingest` / `retrieve` facade with provenance
  - Covered by `scripts/test-personal-knowledge-*.js`

- **Personal Knowledge Shadow Ingest from Inbox (D-019)**
  - After Universal Extraction record: map supported candidates → PK engine (shadow, in-memory)
  - Sanitized `metadata.personalKnowledge` summary; actorKey required; idempotent `requestKey:pk:<index>`
  - Default disabled via `PERSONAL_KNOWLEDGE_ENABLED`; no Telegram / execution / migration / `.env` change
  - Covered by `scripts/test-personal-knowledge-shadow-ingest.js`

- **Reasoning Engine foundation (D-020)**
  - Library: `services/reasoning/*` — Facts → Insights → Recommendations (deterministic, evidence-backed)
  - In-memory actor-scoped store; no Telegram/Inbox/execution wiring; no migration
  - Covered by `scripts/test-reasoning-engine.js`

- **Reasoning Shadow Observation (D-021)**
  - After PK shadow ingest: actor-scoped facts → deriveInsights / deriveRecommendations → sanitized `metadata.reasoning`
  - Defaults off (`REASONING_ENABLED`); audit-only; idempotent via `requestKey`; no LLM / migration / Telegram UX
  - Covered by `scripts/test-reasoning-shadow-observation.js`

- **Answer Engine Architecture (D-022)**
  - Orchestration library `services/answer/*` + `config/answerEngine.js` — plan → retrieve (fixed order) → rank → conflict → compose
  - Reuses Context / PK / Reasoning / World adapter / injectable domain readers; zero execution; no Telegram wiring
  - Covered by `scripts/test-answer-engine.js`

- **Answer Engine Read-Only Integration (D-023)**
  - Telegram questions (`спроси`/`найди`/`вспомни` + open info questions) → `answerRoute` → Answer Engine → reply
  - Execution / navigation / exact commands unchanged; AI Router ownership unchanged; no domain writes
  - Covered by `scripts/test-answer-telegram-path.js`

- **Durable Personal Knowledge + Reasoning Persistence (D-024)**
  - Repository interfaces + in-memory adapters; Supabase drivers; migration `0004` prepared (not applied)
  - Engines unchanged architecturally — DI via `repository`/`store`; actor-scoped RLS helpers; idempotent upserts
  - Covered by `scripts/test-durable-repositories.js`

- **Universal Knowledge Ingestion (D-025)**
  - Normalized document contract + source adapters + chunker + ingestion pipeline (shadow default)
  - Reuses Universal/Entity/Relationship extraction; KnowledgeRepository DI; no Telegram / PK auto-write
  - Covered by `scripts/test-universal-ingestion.js`

- **World Knowledge Gateway (D-026)**
  - Pluggable providers + gateway normalize/dedupe/rank/cache; mock providers only; defaults off
  - Never writes Personal Knowledge
  - Covered by `scripts/test-world-knowledge-gateway.js`

- **Answer Engine World Knowledge Integration (D-027)**
  - Optional `worldKnowledgeGateway` DI into Answer Engine; personal-only queries skip world
  - Personal priority + provenance + conflict exposure
  - Covered by `scripts/test-answer-world-integration.js`

- **Telegram World Knowledge Wiring (D-028)**
  - `createWorldKnowledgeForTelegram` + Answer factory DI; modes off/shadow/active (default off)
  - Shadow audit without reply change; active uses world evidence; timeout/failure fallback
  - Covered by `scripts/test-telegram-world-wiring.js`

- **Official RSS/Atom World Provider (D-029)**
  - Allowlisted HTTPS feeds; RSS 2.0 + Atom parser; relevance filter; SSRF / size / timeout bounds
  - Default registry empty (no invented URLs); factory registers only when feeds enabled
  - Covered by `scripts/test-official-feed-provider.js`

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

- Curate and enable a small verified official HTTPS feed allowlist in `config/worldKnowledgeFeeds.js` (still default-off World Knowledge)
- Wire Universal Ingestion to a non-Telegram entry (API upload / script) in shadow mode
- Apply migration `0004` (Personal Knowledge + Reasoning) after review; optionally wire durable repos via DI (still default in-memory)
- Optional: surface accepted insights/recommendations to users (explicit UX; out of shadow)
- Optional: migrate exact finance read commands (`баланс`, …) onto Answer Engine while preserving reply format
- Temporal Resolver (timezone / ISO due times on clarified task drafts; actor default e.g. `Asia/Bangkok`)
- Deploy Mini App + API over HTTPS; set `VITE_ALMAS_API_MODE=live` / `VITE_ALMAS_API_URL` at build time; set bot `ALMAS_WEB_APP_URL`
- Task/Knowledge per-user ownership so `/api/tasks` and `/api/knowledge` can return scoped rows safely
- Inspect/apply RLS + apply the Knowledge migration (`0001`) to Supabase
- Implement additional source-specific loaders (PDF, Website, Voice, Notes, Instagram transcripts) that populate the same `context.metadata.source` contract and reuse the shared `buildKnowledge` → `saveKnowledge` → chunk/embed pipeline
- Unified RAG across Knowledge + Memory (replacing the two separate search systems)
- Dedicated `tasks` table (replacing the Memory-table workaround)
- Enable Inbox shadow in `.env` (`INBOX_ENABLED=true`, `INBOX_MODE=shadow`) after manual verification against Supabase
- Optional: richer legacy-domain execution summaries on Inbox beyond AI-router `execution[]`
- Extend AI-router active execution beyond `task_create`/`memory_save` to Finance (with explicit duplicate-prevention against the deterministic Finance parser) and, eventually, confirmed destructive/system commands — currently only `task_create`/`memory_save` are whitelisted in `services/inbox/actionExecutor.js`, and `AI_ROUTER_MODE` stays `shadow` in `.env` (see `ARCHITECTURE.md`)

## Future

- Live Mini App surfaces bound to real Inbox / domain reads (after API)
- Household / membership model (wife and family aggregation)
- Domain tables for Ideas, Health, Projects, News, Investments
- Health tracking
- Research agent
- Automation engine
- Multi-interface support (Web application, Voice, public API)
- Multi-user support
