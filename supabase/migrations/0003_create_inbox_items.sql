-- Migration 0003: create inbox_items
--
-- Purpose:
-- Canonical audit / information-structuring layer for all future ALMAS
-- input sources (Telegram text/voice today; YouTube/PDF/image/website/
-- notes/automation later). Inbox records what arrived, how it was
-- classified, and what executed — it does NOT execute Finance/Memory/
-- Tasks/Knowledge itself.
--
-- STATUS: written locally; NOT executed against Supabase in this
-- milestone. Live Telegram routing must not call Inbox until this
-- migration is reviewed and applied.
--
-- RLS style mirrors knowledge_chunks (0002): enable RLS + four separate
-- anon policies (SELECT/INSERT/UPDATE/DELETE), no combined all-ops policy.
-- Matches the current single-user anon-key project setup.
--
-- updated_at: maintained by a BEFORE UPDATE trigger (same pattern as a
-- typical Supabase table). Application code may also set updated_at.

create extension if not exists pgcrypto;

create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  request_key text not null,
  source_type text not null,
  actor_key text not null,
  telegram_user_id bigint,
  chat_id bigint,
  username text,
  first_name text,
  last_name text,
  original_text text not null,
  normalized_text text not null,
  language text not null default 'unknown',
  information_kinds jsonb not null default '[]'::jsonb,
  routing_decision jsonb,
  execution_summary jsonb,
  status text not null default 'received',
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inbox_items_request_key_unique unique (request_key),

  constraint inbox_items_source_type_check check (
    source_type in (
      'telegram_text',
      'telegram_voice',
      'youtube',
      'pdf',
      'image',
      'website',
      'note',
      'automation',
      'unknown'
    )
  ),

  constraint inbox_items_status_check check (
    status in (
      'received',
      'normalized',
      'analyzed',
      'executed',
      'partially_executed',
      'clarification_required',
      'failed',
      'skipped'
    )
  ),

  constraint inbox_items_information_kinds_is_array check (
    jsonb_typeof(information_kinds) = 'array'
  )
);

create index if not exists inbox_items_actor_created_idx
  on public.inbox_items (actor_key, created_at desc);

create index if not exists inbox_items_source_created_idx
  on public.inbox_items (source_type, created_at desc);

create index if not exists inbox_items_status_created_idx
  on public.inbox_items (status, created_at desc);

-- GIN index for contains/@> filters on information_kinds JSON arrays.
create index if not exists inbox_items_information_kinds_gin
  on public.inbox_items using gin (information_kinds);

create or replace function public.set_inbox_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inbox_items_set_updated_at on public.inbox_items;
create trigger inbox_items_set_updated_at
  before update on public.inbox_items
  for each row
  execute function public.set_inbox_items_updated_at();

alter table public.inbox_items enable row level security;

-- ASSUMPTION: anon policies mirror the current single-user anon project
-- setup used by knowledge_chunks (migration 0002) — separate policies
-- per operation, no combined all-ops policy.

drop policy if exists "inbox_items_select_anon" on public.inbox_items;
create policy "inbox_items_select_anon"
  on public.inbox_items
  for select
  to anon
  using (true);

drop policy if exists "inbox_items_insert_anon" on public.inbox_items;
create policy "inbox_items_insert_anon"
  on public.inbox_items
  for insert
  to anon
  with check (true);

drop policy if exists "inbox_items_update_anon" on public.inbox_items;
create policy "inbox_items_update_anon"
  on public.inbox_items
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "inbox_items_delete_anon" on public.inbox_items;
create policy "inbox_items_delete_anon"
  on public.inbox_items
  for delete
  to anon
  using (true);

comment on table public.inbox_items is
  'ALMAS Unified Inbox — audit/structuring layer for inbound messages. Does not execute domain actions.';
