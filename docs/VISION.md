# Vision

## What ALMAS Is

ALMAS is a Personal AI Operating System.

It is not a Telegram bot. Telegram is the first interface, not the product.

## Mission

ALMAS turns information chaos into structured personal data, knowledge, and useful actions.

Help the user think better, decide faster, and spend less time on repetitive work by turning everything important in their life into structured, retrievable knowledge.

## Core Principle

AI recommends. The human decides.

Every action that changes the user's data (saving, merging, deleting) must be approved — implicitly for low-stakes content, explicitly for anything destructive — before it happens.

## What ALMAS Remembers

ALMAS does not store messages. It stores facts extracted from messages.

ALMAS is meant to hold structured information about:

- **Personal Memory** — facts, preferences, people, decisions
- **Knowledge Base** — videos, articles, PDFs, books, voice notes, ideas
- **Finance** — income, expenses, balances, analytics
- **Tasks** — things to do, reminders
- **Health** — habits, metrics
- **Research** — agent-assisted investigation
- **Automation** — repeated actions ALMAS performs on the user's behalf

## Interfaces

Telegram today. Planned: Web application, Voice, Mobile, public API.

The core system is interface-agnostic — every interface is an adapter over the same core logic. The core never depends on any specific interface.

## How Knowledge Is Retrieved

Through Retrieval-Augmented Generation (RAG): the user asks a question in natural language, ALMAS searches its own knowledge base in Supabase, and answers using only what it actually knows, citing sources.

## Long-Term Shape

- A single source of truth for the user's knowledge and personal data: **Supabase**.
- A **Pipeline** that can ingest any type of content (YouTube today; PDF, voice, website next) through the same shape: validate → extract → analyze → structure → store.
- A layer of **AI Agents** that can act on the user's behalf (research, automation) with explicit approval gates.
- Multiple **interfaces** (Telegram, Web, Voice) sharing one core, none of them containing business logic.

## Non-Goals (for now)

- ALMAS is not a general-purpose chatbot.
- ALMAS is not, today, a multi-tenant product for other users.
- ALMAS does not make irreversible decisions without approval.

## Philosophy

ALMAS is not an assistant. ALMAS is a second brain.

- ALMAS helps the user think.
- ALMAS remembers everything.
- ALMAS organizes information.
- ALMAS proposes actions.
- ALMAS automates repetitive work.
- ALMAS never makes final decisions instead of the user.
- ALMAS should reduce cognitive load.
- ALMAS should become smarter every week.
- ALMAS should always preserve the user's knowledge.

Knowledge is the most valuable asset this project produces. Every module exists to improve it.
