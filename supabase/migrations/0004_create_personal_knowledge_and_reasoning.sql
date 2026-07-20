-- Migration 0004: durable Personal Knowledge + Reasoning persistence
--
-- Purpose:
-- Replace temporary in-memory Personal Knowledge / Reasoning stores with
-- actor-scoped Supabase tables. Engines keep Dependency Injection; only
-- repository/driver implementations talk to Supabase.
--
-- STATUS: written locally; NOT executed against Supabase in this milestone.
-- Do not enable durable drivers in production until this migration is
-- reviewed and applied.
--
-- Actor isolation:
--   1) Every row has actor_key; repositories ALWAYS filter by actor_key.
--   2) RLS is enabled. Policies require almas.actor_key GUC to match
--      row.actor_key (set by the Supabase repository before queries).
--      Empty GUC → no rows visible (deny-by-default for anon).
--
-- Idempotency: unique idempotency_key on personal_knowledge and
-- reasoning_insights / reasoning_recommendations (upsert-only).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Session helper: repository sets `almas.actor_key` per request.
-- ---------------------------------------------------------------------------
create or replace function public.almas_current_actor_key()
returns text
language sql
stable
as $$
  select nullif(current_setting('almas.actor_key', true), '');
$$;

create or replace function public.almas_set_actor_key(p_actor_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('almas.actor_key', coalesce(p_actor_key, ''), true);
end;
$$;

revoke all on function public.almas_set_actor_key(text) from public;
grant execute on function public.almas_set_actor_key(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- personal_knowledge
-- ---------------------------------------------------------------------------
create table if not exists public.personal_knowledge (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  telegram_user_id bigint,
  domain text not null,
  scope text not null default 'personal',
  content text not null,
  normalized_content text not null,
  confidence double precision not null default 0,
  entities jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  request_key text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint personal_knowledge_idempotency_unique unique (idempotency_key),
  constraint personal_knowledge_scope_check check (scope = 'personal'),
  constraint personal_knowledge_status_check check (
    status in ('active', 'rejected', 'superseded')
  ),
  constraint personal_knowledge_entities_is_array check (
    jsonb_typeof(entities) = 'array'
  ),
  constraint personal_knowledge_confidence_range check (
    confidence >= 0 and confidence <= 1
  )
);

create index if not exists personal_knowledge_actor_idx
  on public.personal_knowledge (actor_key);

create index if not exists personal_knowledge_actor_domain_idx
  on public.personal_knowledge (actor_key, domain);

create index if not exists personal_knowledge_actor_status_idx
  on public.personal_knowledge (actor_key, status);

create index if not exists personal_knowledge_normalized_idx
  on public.personal_knowledge (actor_key, normalized_content);

create index if not exists personal_knowledge_request_key_idx
  on public.personal_knowledge (request_key)
  where request_key is not null;

create index if not exists personal_knowledge_entities_gin
  on public.personal_knowledge using gin (entities);

create index if not exists personal_knowledge_evidence_gin
  on public.personal_knowledge using gin (evidence);

create or replace function public.set_personal_knowledge_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personal_knowledge_set_updated_at on public.personal_knowledge;
create trigger personal_knowledge_set_updated_at
  before update on public.personal_knowledge
  for each row
  execute function public.set_personal_knowledge_updated_at();

alter table public.personal_knowledge enable row level security;

drop policy if exists "personal_knowledge_select_own" on public.personal_knowledge;
create policy "personal_knowledge_select_own"
  on public.personal_knowledge
  for select
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key());

drop policy if exists "personal_knowledge_insert_own" on public.personal_knowledge;
create policy "personal_knowledge_insert_own"
  on public.personal_knowledge
  for insert
  to anon, authenticated
  with check (actor_key = public.almas_current_actor_key());

drop policy if exists "personal_knowledge_update_own" on public.personal_knowledge;
create policy "personal_knowledge_update_own"
  on public.personal_knowledge
  for update
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key())
  with check (actor_key = public.almas_current_actor_key());

drop policy if exists "personal_knowledge_delete_own" on public.personal_knowledge;
create policy "personal_knowledge_delete_own"
  on public.personal_knowledge
  for delete
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key());

comment on table public.personal_knowledge is
  'ALMAS Personal Knowledge facts — actor-scoped; never store world knowledge.';

-- ---------------------------------------------------------------------------
-- reasoning_insights
-- ---------------------------------------------------------------------------
create table if not exists public.reasoning_insights (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  type text not null,
  confidence double precision not null default 0,
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  request_key text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reasoning_insights_idempotency_unique unique (idempotency_key),
  constraint reasoning_insights_status_check check (
    status in ('active', 'rejected', 'superseded')
  ),
  constraint reasoning_insights_evidence_is_array check (
    jsonb_typeof(evidence) = 'array'
  ),
  constraint reasoning_insights_confidence_range check (
    confidence >= 0 and confidence <= 1
  )
);

create index if not exists reasoning_insights_actor_idx
  on public.reasoning_insights (actor_key);

create index if not exists reasoning_insights_actor_type_idx
  on public.reasoning_insights (actor_key, type);

create index if not exists reasoning_insights_actor_status_idx
  on public.reasoning_insights (actor_key, status);

create index if not exists reasoning_insights_request_key_idx
  on public.reasoning_insights (request_key)
  where request_key is not null;

create index if not exists reasoning_insights_evidence_gin
  on public.reasoning_insights using gin (evidence);

create or replace function public.set_reasoning_insights_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reasoning_insights_set_updated_at on public.reasoning_insights;
create trigger reasoning_insights_set_updated_at
  before update on public.reasoning_insights
  for each row
  execute function public.set_reasoning_insights_updated_at();

alter table public.reasoning_insights enable row level security;

drop policy if exists "reasoning_insights_select_own" on public.reasoning_insights;
create policy "reasoning_insights_select_own"
  on public.reasoning_insights
  for select
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key());

drop policy if exists "reasoning_insights_insert_own" on public.reasoning_insights;
create policy "reasoning_insights_insert_own"
  on public.reasoning_insights
  for insert
  to anon, authenticated
  with check (actor_key = public.almas_current_actor_key());

drop policy if exists "reasoning_insights_update_own" on public.reasoning_insights;
create policy "reasoning_insights_update_own"
  on public.reasoning_insights
  for update
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key())
  with check (actor_key = public.almas_current_actor_key());

drop policy if exists "reasoning_insights_delete_own" on public.reasoning_insights;
create policy "reasoning_insights_delete_own"
  on public.reasoning_insights
  for delete
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key());

comment on table public.reasoning_insights is
  'ALMAS Reasoning insights — derived from personal facts only; actor-scoped.';

-- ---------------------------------------------------------------------------
-- reasoning_recommendations
-- ---------------------------------------------------------------------------
create table if not exists public.reasoning_recommendations (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  insight_id uuid,
  priority integer not null default 0,
  confidence double precision not null default 0,
  summary text not null,
  status text not null default 'active',
  request_key text,
  idempotency_key text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reasoning_recommendations_idempotency_unique unique (idempotency_key),
  constraint reasoning_recommendations_status_check check (
    status in ('active', 'dismissed', 'superseded')
  ),
  constraint reasoning_recommendations_confidence_range check (
    confidence >= 0 and confidence <= 1
  )
);

create index if not exists reasoning_recommendations_actor_idx
  on public.reasoning_recommendations (actor_key);

create index if not exists reasoning_recommendations_insight_idx
  on public.reasoning_recommendations (insight_id)
  where insight_id is not null;

create index if not exists reasoning_recommendations_actor_status_idx
  on public.reasoning_recommendations (actor_key, status);

create or replace function public.set_reasoning_recommendations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reasoning_recommendations_set_updated_at
  on public.reasoning_recommendations;
create trigger reasoning_recommendations_set_updated_at
  before update on public.reasoning_recommendations
  for each row
  execute function public.set_reasoning_recommendations_updated_at();

alter table public.reasoning_recommendations enable row level security;

drop policy if exists "reasoning_recommendations_select_own"
  on public.reasoning_recommendations;
create policy "reasoning_recommendations_select_own"
  on public.reasoning_recommendations
  for select
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key());

drop policy if exists "reasoning_recommendations_insert_own"
  on public.reasoning_recommendations;
create policy "reasoning_recommendations_insert_own"
  on public.reasoning_recommendations
  for insert
  to anon, authenticated
  with check (actor_key = public.almas_current_actor_key());

drop policy if exists "reasoning_recommendations_update_own"
  on public.reasoning_recommendations;
create policy "reasoning_recommendations_update_own"
  on public.reasoning_recommendations
  for update
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key())
  with check (actor_key = public.almas_current_actor_key());

drop policy if exists "reasoning_recommendations_delete_own"
  on public.reasoning_recommendations;
create policy "reasoning_recommendations_delete_own"
  on public.reasoning_recommendations
  for delete
  to anon, authenticated
  using (actor_key = public.almas_current_actor_key());

comment on table public.reasoning_recommendations is
  'ALMAS Reasoning recommendations — derived from insights only; actor-scoped.';
