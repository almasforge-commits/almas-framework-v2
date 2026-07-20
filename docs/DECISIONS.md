# Принятые решения

## D-001

Telegram — не ядро.

Статус

ПРИНЯТО

---

## D-002

Pipeline является основным механизмом обработки.

Статус

ПРИНЯТО

---

## D-003

Memory хранит факты.

Не сообщения.

Статус

ПРИНЯТО

---

## D-004

Каждый Step отвечает только за одну задачу.

Статус

ПРИНЯТО

---

## D-005

Core не зависит от Telegram.

Статус

ПРИНЯТО

---

## D-006

Вся бизнес-логика находится внутри Core.

Не внутри Telegram.

Статус

ПРИНЯТО

---

## D-007

Repository отвечает только за сохранение.

Без бизнес-логики.

Статус

ПРИНЯТО

---

## D-008

Любое архитектурное изменение сначала обсуждается.

После принятия решения документ обновляется.

После этого решение считается окончательным.

---

## D-009

AI-роутер (анализатор намерений и планировщик действий) внедряется поэтапно, через shadow-режим.

Детерминированный router (`routeText()`) не удаляется и остаётся резервным поведением.

AI никогда не вызывает Finance/Memory/Tasks/Knowledge напрямую — только через Safety Validator и (в будущем) явный слой выполнения.

Деструктивные действия всегда требуют явного подтверждения текстом; голос не может их выполнить.

Статус

ПРИНЯТО

---

## D-010

Явный слой выполнения (`services/inbox/actionExecutor.js`) — единственный модуль AI-роутера, которому разрешено вызывать доменные сервисы (Finance/Memory/Tasks/Knowledge). Providers/AI и все остальные модули `services/inbox/` этого делать не могут.

В активном режиме (`AI_ROUTER_MODE=active`) реально выполняются только `task_create` и `memory_save`. Все остальные типы действий (включая finance и любые деструктивные/system_command) всегда пропускаются как `skipped_*` и никогда не выполняются этим слоем.

Детерминированный парсер Finance остаётся единственным источником истины для операций с деньгами; AI не создаёт финансовые записи напрямую, чтобы исключить дублирование.

Эскалация на среднюю модель (Tier 2) больше не происходит только из-за наличия нескольких действий в одном сообщении — уверенный и полный план от Tier 1 принимается как есть.

`AI_ROUTER_MODE` в `.env` остаётся `shadow`; активный режим реализован и покрыт тестами, но не включён в проде.

Статус

ПРИНЯТО

---

## D-011

Навигационное меню на кнопках (`handlers/keyboards/mainMenu.js`, `handlers/routes/menuRoute.js`, `handlers/callbackHandler.js`) заменяет старый длинный текстовый fallback как основной способ навигации, но не заменяет ни одну существующую типизированную команду и не меняет поведение голосового ввода.

Кнопки, которым для ответа нужен произвольный текст (поиск по Знаниям, поиск/вспомнить по Памяти), не создают состояние сессии — они отвечают инструкцией, какую существующую команду напечатать (например, «Напиши: найди `<запрос>`»). UX остаётся stateless.

`ALMAS_WEB_APP_URL` задаётся только в `config/webapp.js` с безопасным значением по умолчанию (не задано); `.env` в рамках этого этапа не изменяется. Пока URL не задан, кнопка «🌐 Открыть ALMAS» остаётся обычной текстовой кнопкой с сообщением «Веб-интерфейс пока не подключён.».

Разделы «Идеи» и «Проекты» — временные заглушки («раздел готовится»); никакая новая модель данных для них не создаётся на этом этапе.

Меню остаётся отдельным exact-match блоком в `routeText()` и не заменяет ownership/confirmations AI-роутера (см. D-012).

Статус

ПРИНЯТО

---

## D-012

Execution ownership: каждое сообщение выполняется ровно одной системой на каждый осмысленный фрагмент.

В `AI_ROUTER_MODE=active` `routeText()` ждёт validated-решение AI (`decideRouting`) до любых legacy side effects. AI владеет только реально выполненными (`execution[].executed === true`) действиями `task_create` и `memory_save`. Finance остаётся у детерминированного legacy-парсера.

Пользовательские подтверждения рендерит только `handlers/routes/aiExecutionRoute.js` (`✅ Задача сохранена` / `🧠 Запомнил.`); `actionExecutor.js` остаётся Telegram-независимым и возвращает только структурированные результаты.

После успешного AI-действия: legacy Memory fallback и стандартный «не понял запрос» не выполняются. На смешанных сообщениях Finance продолжает работать; описание очищается от task-хвоста (`stripTrailingActionClause`).

При ошибке provider/`decideRouting` ownership пустой — legacy поведение без изменений. `executed: false` никогда не блокирует legacy Memory.

Идемпотентность: `message_id` — основной request key; hash — только если `message_id` недоступен. In-memory cache сбрасывается при рестарте процесса.

`AI_ROUTER_MODE` в `.env` остаётся `shadow`.

Статус

ПРИНЯТО

---

## D-013

Unified Inbox — канонический слой аудита и структурирования для всех будущих источников ввода (Telegram text/voice, YouTube, PDF, image, website, notes, automation).

Inbox отвечает на вопросы: что пришло, кто отправил, откуда, как нормализовано, как классифицировано, какие действия предложены/выполнены/пропущены, нужна ли clarification, был ли сбой.

Inbox отделён от доменного хранения (Finance/Memory/Tasks/Knowledge) и **никогда не исполняет** бизнес-действия: не пишет в Finance/Memory/Tasks/Knowledge, не удаляет данные, не шлёт Telegram. Shadow observation / Universal Extraction могут вызывать AI только для аудита, когда Inbox включён.

Почему выключен по умолчанию: defaults `INBOX_ENABLED=false`, `INBOX_MODE=off`. Миграция `0003` применена; shadow observation + Universal Extraction подключены в код, но не активны без env.

Идемпотентность: уникальный `request_key` (Telegram `message_id` через `buildRequestKey`). Идентичность актора: `actor_key = telegram:<telegram_user_id>`; username — только display metadata; `chat_id` — контекст, не identity. Household/family aggregation — явно будущая работа.

Статус

ПРИНЯТО

---

## D-014

Universal Information Extraction — shadow-only слой, который из одного сообщения выделяет несколько независимых структурированных candidate items (finance / task / idea / health / project / …).

Extractor производит кандидатов (entities, confidence, clarification flags), валидирует и санитизирует их, и записывает результат в Inbox (`metadata.universalExtraction` / `routing_decision.universalExtraction`). Он **не исполняет** Idea/Health/Project/News/Investment/Contact и не меняет ownership Finance/Task/Memory.

Inbox остаётся audit-слоем. Активация доменов — отдельно, по одному kind за раз. Provider failure не влияет на routing / Telegram replies.

Статус

ПРИНЯТО

---

## D-015

Telegram Mini App (`mini-app/`) — слой представления. ALMAS Core (бот / сервисы) остаётся источником бизнес-логики.

Mini App обращается только к будущему HTTPS API бэкенда ALMAS. Прямой привилегированный доступ к Supabase из клиента запрещён. Foundation v1 использует mock-данные через `apiClient` / `mockApi`.

`initDataUnsafe` — только для UI (приветствие/тема). Аутентификация на бэкенде — по сырому подписанному `initData` с проверкой подписи Telegram. Деплой и `ALMAS_WEB_APP_URL` в этом этапе не выполняются; живое меню бота не меняется, пока URL не задан.

Статус

ПРИНЯТО

---

## D-016

Read-only Mini App API (`api/`) — отдельный Express HTTP-процесс (`npm run api`), не меняющий Telegram polling (`npm start` / `index.js`).

Аутентификация только через ALMAS-конвенцию `Authorization: tma <raw initData>` и официальную bot-token HMAC-проверку Telegram; `initDataUnsafe`, query/body/cookie/user-id header не принимаются. Все ошибки auth → одинаковый generic `401 unauthorized`. Каждый read fail-closed по validated actor. Inbox API не зависит от `INBOX_ENABLED`. Эндпоинты только GET; envelope `{ data }` / `{ error }`.

Application-level filters не заменяют Supabase RLS. Tasks/Knowledge без enforceable ownership → `[]`. Mini App клиент пока на mock; деплой и `.env` не меняются.

Статус

ПРИНЯТО

---

## D-017

Conversation Context + Clarification Engine — foundation for multi-turn completion of incomplete `task_create`, `memory_save`, and incomplete deterministic finance drafts (missing currency and/or description).

Pending state is per `(actorKey, chatId)`, in an injectable bounded in-memory store (TTL 15 minutes; get/set/update/clear/expire; idempotency by `requestKey`). No migration. Questions are deterministic and field-based (no LLM phrasing):

- task content → `Что нужно сделать?`
- memory content → `Что нужно запомнить?`
- finance currency → `В какой валюте была операция?`
- finance description → `На что были потрачены деньги?`
- both finance fields → ask one at a time, currency first, then description

Cancel phrases (exact normalized): `отмена`, `отменить`, `не надо`, `cancel`, `stop` → reply `Операция отменена.` and clear pending (never execute). Expired pending is cleared silently; the new message is processed normally.

**Ask policy:**

- `AI_ROUTER_MODE=shadow`: do **not** create user-visible clarification flows from AI-only / task / memory plans; previous single-turn behavior unchanged.
- `AI_ROUTER_MODE=active`: clarification may be shown for `task_create` and `memory_save`.
- Incomplete deterministic finance: clarification may run in **any** AI router mode (Finance remains legacy-owned).

Finance writes go through legacy `addExpense` / `addIncome` only after the draft is complete. The AI executor never executes finance. Temporal phrases (e.g. `завтра`) are stored as `unresolvedTemporal` only — no ISO/timezone invent in this milestone.

Out of scope: Temporal resolver, Mini App, household/RLS, entity graph, world knowledge, Idea/Health/Project execution, schema migrations, deploy, `.env` changes.

Статус

ПРИНЯТО

---

## D-018

Personal Knowledge Engine Foundation — modular intelligence layer that classifies user-grounded information into a closed personal ontology (Identity, Preferences, Goals, Projects, Ideas, Health, Contacts, Decisions, Habits, Knowledge, Finance, Tasks; Timeline is retrieval-only), validates confidence, rejects world/general knowledge and hallucinations, and exposes a single `retrieve()` facade with provenance.

**Personal vs World:** only verified user-grounded personal facts may be stored (`scope: "personal"`). World retrieval is read-only via an injectable adapter and must never be written into the personal store.

**v1 constraints:** deterministic classifier only (RU/EN); injectable bounded in-memory store (no migration); idempotency via `requestKey` or stable hash of `actorKey + domain + normalizedContent`; actor-scoped reads/writes; no Telegram / Inbox / AI-router / Mini App / API / Finance / Tasks / Knowledge-ingestion wiring; Domain Registry used only as a kind→PK-domain mapping source (not a competing registry). Engine does not execute any domain.

Статус

ПРИНЯТО

---

## D-019

Personal Knowledge Shadow Ingest from Inbox — after Universal Extraction is recorded, validated extraction candidates are fed into the Personal Knowledge Engine in **shadow mode** only.

Uses already-produced extraction results (no re-extraction, no new LLM calls). Actor identity is `actor.actorKey` only. Supported kinds: `memory`, `goal`, `decision`, `contact`, `idea`, `health`, `project`, `finance`, `task`, `knowledge`. Rejects clarification-required, low-confidence, unsupported, world/general, and missing-actor candidates. Idempotency key: `requestKey:pk:<index>`.

A sanitized summary is written to Inbox `metadata.personalKnowledge` (`attempted` / `accepted` / `rejected` / `acceptedDomains` / `rejectedReasons` / `shadow: true`) — never full facts, prompts, vectors, or raw dumps. Failures never break Inbox processing or Telegram replies. When `PERSONAL_KNOWLEDGE_ENABLED` is false (default), ingest is a no-op. No migration; in-memory PK store only. No Telegram / AI-router execution / Finance / Tasks / Mini App / API / `.env` changes.

Статус

ПРИНЯТО

---

## D-020

Reasoning Engine Foundation — standalone intelligence layer that derives **insights** and **recommendations** from already stored personal facts.

**Facts → Insights → Recommendations.** The engine never invents facts and never calls an LLM in v1. Deterministic rules inspect personal facts only (never world knowledge, never temporary clarification context). Every insight carries evidence (`factId`, `weight`, `reason`). Recommendations are generated only from accepted insights, never directly from raw facts.

Storage is a bounded in-memory, actor-scoped store with idempotent upserts. No Telegram wiring, no Inbox/AI-router/Mini App/API hooks, no migration, no `.env` changes. Ready for a later shadow observation connection.

Статус

ПРИНЯТО

---

## D-021

Reasoning Shadow Observation — after Personal Knowledge shadow ingest, the Reasoning Engine may derive deterministic insights and recommendations from **accepted actor-scoped personal facts only**, and record a sanitized audit summary on Inbox `metadata.reasoning`.

**Guarantees:** no Telegram UX; no domain execution changes; no LLM; no world knowledge as evidence; no persistent insight table; recommendations only from insights; idempotent via `requestKey` + existing Reasoning Store. Enabled only when Inbox observation is active, Personal Knowledge is enabled, and Reasoning is enabled (`REASONING_ENABLED`, default false; mode `shadow` only). When disabled → safe no-op. Failures never break Inbox processing.

Audit shape: `{ reasoning: { attempted, factsConsidered, insightsDerived, recommendationsDerived, insightTypes[], rejectedReasons{}, shadow: true } }` — counts and type/reason codes only.

Статус

ПРИНЯТО

---

## D-022

Answer Engine Architecture — orchestration layer above Clarification, Personal Knowledge, Reasoning, World Knowledge adapter, and existing domain readers. It decides **which services participate** in an evidence-based answer; it does not replace those services or duplicate their logic.

**Pipeline (fixed order):** Intent/plan → Conversation Context → Personal Knowledge → Reasoning → World Knowledge → Domain readers → merge → rank → conflict resolve → compose → confidence / clarification / sources.

**Guarantees:** personal priority over world; world provenance required; never store world into PK; deterministic ranking/confidence; mark conflicts (keep both); `execution` always `none` in this milestone; injectable deps only; no LLM / new AI pipeline; no Telegram / Mini App / API / schema / migration / handler wiring.

Статус

ПРИНЯТО

---

## D-023

Answer Engine Read-Only Integration — Telegram information questions are answered through the Answer Engine as the **single read-only intelligence reply layer**.

**Routing:** navigation / exact commands / Finance·Task·Memory **execution** keep existing handlers. Genuine questions (`спроси` / `найди` / `найти` / `вспомни` and open interrogatives via `detectDeterministicIntent` + question gate) call `maybeHandleAnswerQuestion` → Answer Engine → formatted Telegram reply.

**Guarantees:** `execution` always `none`; no Finance/Task/Memory/Inbox writes from this path; no AI Router ownership changes; no Mini App / API / schema / migration / `.env` changes. Personal priority and world provenance preserved by the existing Answer Engine pipeline.

Статус

ПРИНЯТО

---

## D-024

Durable Personal Knowledge Persistence — Personal Knowledge and Reasoning gain a **repository layer** with Supabase drivers, without changing engine architecture or Answer Engine contracts.

**Pattern:** Engines depend on repository interfaces via DI (`deps.repository` / `deps.store`). In-memory repositories remain the default for tests and current runtime. `SupabasePersonalKnowledgeRepository` / `SupabaseReasoningRepository` are the only modules that import Supabase.

**Schema (migration `0004`, not applied):** `personal_knowledge`, `reasoning_insights`, `reasoning_recommendations` — actor-scoped; unique `idempotency_key`; GIN where useful; RLS via `almas.actor_key` session GUC + own-row policies.

**Idempotency:** PK prefers `requestKey` then hash(`actorKey+domain+normalizedContent`); Reasoning uses `requestKey:reasoning…` / insight idempotency keys — upsert only.

**Guarantees:** no Telegram / Mini App / execution / AI Router / Answer contract changes; migrations are prepared only.

Статус

ПРИНЯТО

---

## D-025

Universal Knowledge Ingestion — all external knowledge enters through one normalized pipeline: Source Adapter → Normalized Document → Chunking → Universal Extraction → Entity → Relationship → optional Inbox observation → KnowledgeRepository.

**Contract:** every adapter emits `{ id, sourceType, title, author, url, language, createdAt, updatedAt, metadata, content, sections, attachments, checksum }`.

**Modes:** `dry_run` / `shadow` (default) / `active`. Shadow writes only via injected KnowledgeRepository (in-memory by default). Never auto-writes Personal Knowledge. Does not replace the existing YouTube Telegram workflow; YouTube adapter reuses the existing info loader.

**Guarantees:** no Telegram UX / Answer Engine / execution / AI Router / Mini App / API / `.env` / package changes in this milestone.

Статус

ПРИНЯТО

---

## D-026

World Knowledge Gateway — standalone, injectable entry point for all **external** knowledge providers. Retrieves, normalizes, ranks, and returns world results with full provenance. Never stores world knowledge as personal knowledge; never replaces Personal Knowledge; not wired into Answer Engine/Telegram in this milestone.

**Architecture:** Provider Manager (register/unregister/list) → providers → normalize → dedupe → score/rank → optional TTL cache → structured evidence (`scope: "world"`).

**Provider contract:** `initialize`, `search`, `health`, `shutdown`. Output: `{ provider, title, summary, url, publishedAt, language, author, confidence, sourceType, metadata }` — no raw HTML.

**Defaults:** disabled (`enabled: false`); mock/static providers only (no HTTP). Config: `config/worldKnowledge.js`.

Статус

ПРИНЯТО

## D-027

Answer Engine World Knowledge Integration — connect the existing World Knowledge Gateway into the Answer Engine so answers may use **Personal Knowledge** and **World Knowledge** together, with scopes fully isolated.

**Retrieval flow:** Conversation Context → Personal Knowledge → Reasoning → World Knowledge Gateway (when needed) → Domain readers → Ranking → Conflict Resolution → Final Answer.

**World retrieval decision:** deterministic `decideWorldRetrieval` — skip for personal-only queries (`my tasks/ideas/projects/expenses/goals/notes`, RU equivalents); call for external/general questions (`what is…`, `latest…`, topic cues). Gateway optional via DI; Answer Engine works without it; no globals/singletons; Telegram factory does not auto-wire.

**Personal vs World:** personal facts always win; on disagreement keep both, mark conflict, reduce confidence; never overwrite/hide; world never persisted into Personal Knowledge; world statements keep provenance (`provider`, `retrievedAt`, `url`, `sourceType`, `confidence`, `language`, `publishedAt`).

**Contracts:** populate existing optional fields only (`usedWorldKnowledge`, `worldSources`, `conflicts`, `confidence`, flags). No Telegram formatting / execution / schema / `.env` changes.

Статус

ПРИНЯТО

## D-028

Telegram World Knowledge Wiring — inject the existing World Knowledge Gateway into the Telegram Answer Engine factory behind **default-off** configuration. Live Telegram answers may use World Knowledge only when explicitly enabled.

**Modes (`WORLD_KNOWLEDGE_MODE` + `WORLD_KNOWLEDGE_ENABLED`):**
- `off` (default): no gateway construction; zero provider calls; Telegram behavior unchanged
- `shadow`: gateway may run for qualifying questions; sanitized audit only (`attempted`, `providersCalled`, `resultsReceived`, `latencyMs`, `reason`); world evidence suppressed from Answer output so replies match no-world
- `active`: Answer Engine may include world evidence with provenance; personal priority and conflicts unchanged

**DI:** `createWorldKnowledgeForTelegram` composition root → optional gateway into `createTelegramAnswerEngine` / `createTelegramAnswerEngineWithWorld` → `answerRoute`. No globals/singletons. Mock providers never auto-enabled unless `allowMockProviders` (tests). No real HTTP providers in this milestone.

**Guarantees:** read-only; no PK/Memory/Finance/Task writes; gateway timeout + failure fall back to personal/domain; no raw provider payloads in logs; no `.env` / schema / Mini App / API changes.

Статус

ПРИНЯТО

## D-029

Official RSS/Atom World Knowledge Provider — first real read-only external provider. Fetches only **explicit allowlisted HTTPS** RSS 2.0 / Atom feeds; normalizes through the existing Gateway; never scrapes article pages; never persists into Personal Knowledge.

**Registry:** `config/worldKnowledgeFeeds.js` — static definitions (`id`, `title`, `url`, `organization`, `sourceType`, `trustScore`, `topics`, `languages`, `enabled`). Default list is **empty** until verified official feeds are curated (no invented URLs). Duplicate ids/urls and non-HTTPS rejected.

**Provider:** `services/worldKnowledge/providers/officialFeedProvider.js` — `initialize` / `search` / `health` / `shutdown`. Built-in `fetch` + minimal safe XML field extraction (no new packages). Query relevance via deterministic token/title/summary/topic scoring with minimum threshold; stable ordering; max age / max items / timeout / max bytes.

**SSRF:** exact allowlist only; HTTPS-only; `redirect: error`; reject localhost/private/IP literals; no cookies/auth; no user-supplied feed URLs; XML/RSS/Atom content types only; reject HTML masquerades.

**Wiring:** factory registers OfficialFeedProvider only when World Knowledge effective mode is shadow/active **and** ≥1 enabled feed. Off → zero fetches. Shadow → D-028 audit, replies unchanged. Active → world evidence with provenance. No API keys.

Статус

ПРИНЯТО
