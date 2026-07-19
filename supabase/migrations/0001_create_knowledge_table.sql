-- Migration: create knowledge table
--
-- Purpose:
-- Move the active Knowledge storage (currently local JSON files under
-- knowledge/youtube/*.json) to Supabase, while preserving the existing
-- Knowledge object shape used throughout the app:
--   { id, type, title, summary, keyPoints, tags, ideas, tasks,
--     source, fingerprint, status, createdAt, updatedAt }
--
-- Notes:
-- - id is generated in application code (crypto.randomUUID()), so no
--   default is required, but one is provided as a safety net.
-- - Duplicate detection stays in application code
--   (services/storage/knowledgeService.js -> findDuplicate()); the
--   fingerprint index below is for lookup performance only, not a
--   uniqueness guarantee.
-- - Row Level Security is intentionally left disabled here, matching the
--   apparent configuration of the existing finance_transactions/memories
--   tables (both are queried with the anon key elsewhere in this codebase
--   with no RLS-related handling). Revisit if your project enforces RLS.
--
-- This migration has NOT been executed against Supabase yet. Run it
-- manually (Supabase SQL editor or `supabase db push`) when ready.

create extension if not exists pgcrypto;

create table if not exists knowledge (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  summary text not null,
  key_points jsonb not null default '[]',
  tags jsonb not null default '[]',
  ideas jsonb not null default '[]',
  tasks jsonb not null default '[]',
  source jsonb not null default '{}',
  fingerprint text,
  status text not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_fingerprint_idx on knowledge (fingerprint);
create index if not exists knowledge_type_idx on knowledge (type);
create index if not exists knowledge_updated_at_idx on knowledge (updated_at desc);
