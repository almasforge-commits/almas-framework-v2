-- Migration 0006: create capture_sessions
--
-- Purpose:
-- Hold one pending Unified Capture Session per incoming message until the
-- user confirms, cancels, or the session expires. Draft actions live in
-- draft_json — permanent Finance / Ideas / Memory / Tasks tables are
-- written only by the batch executor after confirmation.
--
-- STATUS: written locally; apply in Supabase before durable capture
-- sessions across restarts. Live Telegram still works with the
-- in-memory store when this table is not yet applied.
--
-- RLS style mirrors inbox_items (0003): enable RLS + anon policies.

create extension if not exists pgcrypto;

create table if not exists public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  chat_id bigint,
  source text not null default 'text',
  original_text text not null,
  draft_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  request_key text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),

  constraint capture_sessions_source_check check (
    source in ('text', 'voice', 'telegram_text', 'telegram_voice', 'unknown')
  ),

  constraint capture_sessions_status_check check (
    status in (
      'pending',
      'editing',
      'confirmed',
      'cancelled',
      'expired',
      'failed'
    )
  ),

  constraint capture_sessions_draft_is_object check (
    jsonb_typeof(draft_json) = 'object'
  )
);

create index if not exists capture_sessions_actor_chat_status_idx
  on public.capture_sessions (actor_key, chat_id, status)
  where status in ('pending', 'editing');

create index if not exists capture_sessions_expires_idx
  on public.capture_sessions (expires_at)
  where status in ('pending', 'editing');

create index if not exists capture_sessions_request_key_idx
  on public.capture_sessions (request_key)
  where request_key is not null;

alter table public.capture_sessions enable row level security;

create policy "capture_sessions_select_anon"
  on public.capture_sessions for select to anon using (true);

create policy "capture_sessions_insert_anon"
  on public.capture_sessions for insert to anon with check (true);

create policy "capture_sessions_update_anon"
  on public.capture_sessions for update to anon using (true) with check (true);

create policy "capture_sessions_delete_anon"
  on public.capture_sessions for delete to anon using (true);

create or replace function public.set_capture_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists capture_sessions_set_updated_at on public.capture_sessions;
create trigger capture_sessions_set_updated_at
  before update on public.capture_sessions
  for each row
  execute function public.set_capture_sessions_updated_at();
