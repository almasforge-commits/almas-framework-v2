Source: docs/ARCHITECTURE.md

Current (fully implemented for YouTube only):

Telegram

↓

Handlers

↓

Services

↓

Providers

↓

Pipeline

↓

Knowledge (JSON, migrating to Supabase)

Target:

Telegram / Web / Voice

↓

Inbox

↓

Classifier

↓

Pipeline

↓

Knowledge

↓

Supabase

↓

RAG

↓

OpenAI

↓

Response

Rule: Core never knows about Telegram. All interfaces are adapters.
