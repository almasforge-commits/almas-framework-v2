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

- **Navigation menu (button-based main menu)**
  - Persistent `ReplyKeyboardMarkup` main menu (📚 Знания / 💡 Идеи / 📋 Задачи / 🚀 Проекты / 💰 Финансы / 🧠 Память / 🌐 Открыть ALMAS / ❓ Помощь) shown on `/start`, `"меню"`, and pressing "🏠 Главная"; also shown as the new fallback ("Не понял запрос. Выбери раздел в меню 👇") instead of the old long command-list text (which moved, byte-for-byte, into `sendHelp()`, reachable via "❓ Помощь")
  - `handlers/keyboards/mainMenu.js` (pure keyboard builders), `handlers/routes/menuRoute.js` (one `send*()` per section, reusing existing unmodified read functions only), `handlers/callbackHandler.js` (`registerCallbackHandler()`, wired in `index.js` next to `registerMessageHandler()`), `config/webapp.js` (`ALMAS_WEB_APP_URL`, unset by default, `.env` untouched)
  - Knowledge/Tasks/Finance/Memory sections show live data via `getAllKnowledge`/`getActiveTasks`+`getCompletedTasks`/`getBalance`+`getHistory`+`getStatistics` — no new storage or business logic
  - Stateless by design: Knowledge/Memory search and Memory recall buttons reply with the existing typed command to use (e.g. "Напиши: найди `<запрос>`") instead of introducing session state
  - Ideas and Projects are clean placeholders only ("раздел готовится")
  - Menu dispatch remains a separate exact-match block from AI ownership; AI confirmations never replace menu button handling
  - Covered by `scripts/test-main-menu-keyboards.js`, `scripts/test-menu-route.js`, `scripts/test-callback-handler.js`, plus extended `scripts/test-message-router-extraction.js`
  - Known limitation: "🌐 Открыть ALMAS" always shows "Веб-интерфейс пока не подключён." until `ALMAS_WEB_APP_URL` is set to a real `https://` URL (no web app exists yet)

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
- Wire up the existing but unused Inbox content-type classifier (`services/inbox/inboxClassifier.js`)
- Extend AI-router active execution beyond `task_create`/`memory_save` to Finance (with explicit duplicate-prevention against the deterministic Finance parser) and, eventually, confirmed destructive/system commands — currently only `task_create`/`memory_save` are whitelisted in `services/inbox/actionExecutor.js`, and `AI_ROUTER_MODE` stays `shadow` in `.env` (see `ARCHITECTURE.md`)

## Future

- Health tracking
- Research agent
- Automation engine
- Multi-interface support (Web application, Voice, public API)
- Multi-user support
