-- Migration: add knowledge_chunks (chunking + embeddings for RAG)
--
-- Scope (deliberately limited):
--   - vector extension
--   - knowledge.raw_content column
--   - knowledge_chunks table
--   - foreign key to knowledge
--   - indexes (lookup by knowledge_id, similarity search on embedding)
--   - match_knowledge_chunks RPC (security invoker, same as before)
--   - RLS enabled on knowledge_chunks, with one separate anon policy
--     per operation (select/insert/update/delete) instead of one broad
--     FOR ALL policy.
--
-- ASSUMPTION (accepted as correct per explicit instruction, not verified
-- by inspecting the live database):
--   0001_create_knowledge_table.sql, as written, has NO RLS/policy
--   statements at all — its own comment says RLS was "intentionally
--   left disabled" at the time it was authored. That comment predates
--   the later, explicit confirmation that `knowledge` does have RLS
--   policies live in Supabase (anon role, one policy per operation, no
--   FOR ALL). This file mirrors that confirmed live style rather than
--   0001's stale comment, since 0001's file contents and the live
--   database are known to have diverged and the live behavior is the
--   one being treated as correct here.
--
-- This migration has NOT been executed against Supabase yet.

create extension if not exists vector;

alter table knowledge
  add column if not exists raw_content text;

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references knowledge(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  token_count int,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (knowledge_id, chunk_index)
);

create index if not exists knowledge_chunks_knowledge_id_idx
  on knowledge_chunks (knowledge_id);

create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- Row Level Security: enabled, with one narrow policy per operation
-- (no broad FOR ALL policy), granted to the anon role — matching the
-- confirmed live policy style on `knowledge`. See the "ASSUMPTION"
-- note at the top of this file.

alter table knowledge_chunks enable row level security;

-- Postgres has no "CREATE POLICY IF NOT EXISTS", so each policy is
-- dropped first to keep this migration safely re-runnable.

drop policy if exists "knowledge_chunks_select_anon" on knowledge_chunks;
create policy "knowledge_chunks_select_anon"
  on knowledge_chunks
  for select
  to anon
  using (true);

drop policy if exists "knowledge_chunks_insert_anon" on knowledge_chunks;
create policy "knowledge_chunks_insert_anon"
  on knowledge_chunks
  for insert
  to anon
  with check (true);

drop policy if exists "knowledge_chunks_update_anon" on knowledge_chunks;
create policy "knowledge_chunks_update_anon"
  on knowledge_chunks
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "knowledge_chunks_delete_anon" on knowledge_chunks;
create policy "knowledge_chunks_delete_anon"
  on knowledge_chunks
  for delete
  to anon
  using (true);

create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  chunk_id uuid,
  knowledge_id uuid,
  content text,
  similarity float,
  knowledge_title text,
  knowledge_type text,
  knowledge_source jsonb
)
language sql stable
security invoker
as $$
  select
    c.id as chunk_id,
    c.knowledge_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    k.title as knowledge_title,
    k.type as knowledge_type,
    k.source as knowledge_source
  from knowledge_chunks c
  join knowledge k on k.id = c.knowledge_id
  where 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- =====================================================================
-- STATUS
-- =====================================================================
-- - match_knowledge_chunks: security invoker (per explicit instruction;
--   RLS policies above govern access instead of function-level bypass).
-- - RLS: enabled on knowledge_chunks, four anon policies (one per
--   operation), no FOR ALL policy — accepted as matching the live
--   `knowledge` configuration per explicit instruction (see the
--   "ASSUMPTION" note at the top of this file). Not independently
--   verified by inspecting the database.
-- - This migration is still NOT executed against Supabase.
