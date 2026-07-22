-- 0007_actor_finance_settings_and_fx_rates.sql
-- Optional FX / base-currency support for Dashboard & Finance summaries.
-- Does NOT change finance_transactions meaning or amounts.
-- Idempotent where feasible. Do NOT auto-apply — run manually in Supabase SQL editor
-- or via `supabase db push` after review.
--
-- Rollback considerations:
--   DROP TABLE IF EXISTS public.fx_rates;
--   DROP TABLE IF EXISTS public.actor_finance_settings;
-- (Safe if no production writers depend on these yet.)

CREATE TABLE IF NOT EXISTS public.actor_finance_settings (
  actor_key text PRIMARY KEY,
  user_id text,
  base_currency text NOT NULL DEFAULT 'VND',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT actor_finance_settings_base_currency_check
    CHECK (base_currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS actor_finance_settings_user_id_idx
  ON public.actor_finance_settings (user_id);

CREATE TABLE IF NOT EXISTS public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric NOT NULL CHECK (rate > 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_rates_currency_check CHECK (
    base_currency ~ '^[A-Z]{3}$' AND quote_currency ~ '^[A-Z]{3}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_rates_source_pair_effective_uidx
  ON public.fx_rates (source, base_currency, quote_currency, effective_at);

CREATE INDEX IF NOT EXISTS fx_rates_lookup_idx
  ON public.fx_rates (base_currency, quote_currency, effective_at DESC);

COMMENT ON TABLE public.actor_finance_settings IS
  'Per-actor reporting/base currency preference. Default VND when absent.';
COMMENT ON TABLE public.fx_rates IS
  'Cached FX quotes for analytics only. Original transactions stay in native currency.';

-- RLS: enable and deny-by-default; service role / server uses privileged client.
ALTER TABLE public.actor_finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
