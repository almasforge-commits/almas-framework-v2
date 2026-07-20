# ALMAS Domains

`config/domainRegistry.js` is the **single source of truth** for every ALMAS product domain.

Extraction kinds, Inbox information kinds, and AI-router action-type membership are derived from this registry. Do not maintain parallel hardcoded domain lists in feature modules.

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable machine id (`finance`, `idea`, …) |
| `title` | Human title |
| `description` | Short purpose |
| `icon` | UI glyph |
| `enabled` | Domain is part of the product surface |
| `extractable` | Universal Extractor may emit this kind |
| `executable` | AI router may write this domain today |
| `supportsSearch` | Domain is searchable |
| `supportsTimeline` | Domain has time-ordered views |
| `supportsAI` | AI may classify/extract this domain |
| `futureTable` | Planned Supabase table name, or `null` if existing/none |

## Domains

| id | Purpose | Executable today | Future table |
|---|---|---|---|
| `finance` | Income, expenses, balances, analytics | No (legacy Finance parser owns writes) | — (`finance_transactions`) |
| `task` | To-dos and reminders | Yes (`task_create` via AI, still stored in `memories`) | `tasks` |
| `memory` | Personal facts and preferences | Yes (`memory_save`) | — (`memories`) |
| `idea` | Captured ideas | No | `ideas` |
| `health` | Structured health metrics | No | `health_metrics` |
| `knowledge` | Knowledge base / RAG sources | No (query only) | — (`knowledge`) |
| `project` | Project updates and status | No | `projects` |
| `investment` | Investment notes | No | `investments` |
| `news` | News snippets | No | `news_items` |
| `contact` | People / contacts | No | `contacts` |
| `decision` | Explicit decisions | No | `decisions` |
| `goal` | Longer-term goals | No | `goals` |
| `event` | Dated events | No | `events` |
| `journal` | Journal entries | No | `journal_entries` |
| `command` | System / destructive commands | No (confirmation-gated) | — |
| `chat` | Conversational Q&A | No | — |
| `search` | Search intents | No | — |
| `unknown` | Unclassified content | No | — |

## Helpers

- `getDomain(id)`
- `listDomains()`
- `isKnownDomain(id)`
- `getExtractableDomains()`
- `getExecutableDomains()`
- `listRouterActionTypes()` / `getDomainIdForActionType(actionType)`

## Rules

- Universal Extraction and Inbox classification read kinds from the registry.
- Enabling a new executable domain is a separate, explicit milestone (registry `executable: true` + actionExecutor whitelist + tests).
- Inbox remains the audit layer; the registry does not execute anything.
