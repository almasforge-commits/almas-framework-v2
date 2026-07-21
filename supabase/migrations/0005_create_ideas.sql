-- Migration 0005: create ideas (Ideas Capture System)
--
-- Purpose:
-- First-class persistent Ideas for ALMAS Intelligence Core.
-- Captures user thoughts with AI/heuristic classification; survives restarts.
-- Answer Engine and Mini App read from this table (no parallel memory store).
--
-- STATUS: written locally; apply in Supabase before live Ideas capture.
-- RLS style mirrors inbox_items (0003): enable RLS + anon policies.
--
-- Embedding dimension matches OpenAI text-embedding-3-small (1536),
-- same as memories / knowledge_chunks.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  telegram_user_id bigint,
  chat_id bigint,
  original_text text not null,
  normalized_text text not null,
  source text not null default 'text',
  language text not null default 'unknown',
  category text not null default 'other',
  confidence double precision not null default 0.5,
  tags jsonb not null default '[]'::jsonb,
  embedding vector(1536),
  related_project_ids jsonb not null default '[]'::jsonb,
  related_memory_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ideas_source_check check (
    source in ('text', 'voice', 'telegram_text', 'telegram_voice', 'unknown')
  ),

  constraint ideas_category_check check (
    category in (
      'content',
      'business',
      'project',
      'life',
      'health',
      'sport',
      'learning',
      'observation',
      'travel',
      'finance',
      'other'
    )
  ),

  constraint ideas_confidence_check check (
    confidence >= 0 and confidence <= 1
  ),

  constraint ideas_tags_is_array check (jsonb_typeof(tags) = 'array'),
  constraint ideas_related_project_ids_is_array check (
    jsonb_typeof(related_project_ids) = 'array'
  ),
  constraint ideas_related_memory_ids_is_array check (
    jsonb_typeof(related_memory_ids) = 'array'
  )
);

create index if not exists ideas_actor_created_idx
  on public.ideas (actor_key, created_at desc);

create index if not exists ideas_actor_category_idx
  on public.ideas (actor_key, category)
  where archived = false;

create index if not exists ideas_tags_gin_idx
  on public.ideas using gin (tags);

create index if not exists ideas_embedding_hnsw_idx
  on public.ideas
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create or replace function public.set_ideas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ideas_set_updated_at on public.ideas;
create trigger ideas_set_updated_at
  before update on public.ideas
  for each row
  execute function public.set_ideas_updated_at();

-- Semantic search over actor-scoped ideas (ownership via filter in app
-- when RPC rows omit actor; prefer passing actor_key when available).
create or replace function public.match_ideas(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 10,
  filter_actor_key text default null
)
returns table (
  id uuid,
  actor_key text,
  original_text text,
  normalized_text text,
  category text,
  confidence float,
  tags jsonb,
  created_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    i.id,
    i.actor_key,
    i.original_text,
    i.normalized_text,
    i.category,
    i.confidence::float,
    i.tags,
    i.created_at,
    (1 - (i.embedding <=> query_embedding))::float as similarity
  from public.ideas i
  where i.archived = false
    and i.embedding is not null
    and (filter_actor_key is null or i.actor_key = filter_actor_key)
    and (1 - (i.embedding <=> query_embedding)) >= match_threshold
  order by i.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

alter table public.ideas enable row level security;

drop policy if exists ideas_select_anon on public.ideas;
drop policy if exists ideas_insert_anon on public.ideas;
drop policy if exists ideas_update_anon on public.ideas;
drop policy if exists ideas_delete_anon on public.ideas;

create policy ideas_select_anon on public.ideas
  for select to anon using (true);

create policy ideas_insert_anon on public.ideas
  for insert to anon with check (true);

create policy ideas_update_anon on public.ideas
  for update to anon using (true) with check (true);

create policy ideas_delete_anon on public.ideas
  for delete to anon using (true);
