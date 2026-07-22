# Multi-currency FX (Finance summaries)

## Root cause (2026-07 production)

Logs showed `baseCurrency=KZT`, `status=partial`, `rateCount=0`, `cacheHit=false`.

**Why:**

1. Default provider was `none` (no HTTP, no rates) — only same-currency KZT rows entered totals.
2. Even with `FX_PROVIDER=frankfurter`, **Frankfurter/ECB does not support KZT or VND** (HTTP 404). Only majors like EUR↔USD work.

## Fix

- Default provider: **`open-er-api`** (`https://open.er-api.com/v6/latest/USD`) — free, no API key, includes KZT + VND.
- One HTTP call loads a full USD rate table; any pair converts via USD pivot.
- Table + pair caches → second request reports `cacheHit=true`, `rateCount>0`, `status=ok`.
- `FX_PROVIDER=frankfurter` now composites with open-er-api (Frankfurter alone cannot price KZT/VND).

## Policy

1. Original transactions are never rewritten.
2. Conversion is for summaries/analytics only.
3. Dashboard / current period uses latest cached rates.
4. Historical reports should use closest `effective_at <= transaction date` when dated rates exist.

## Base currency resolution

1. `actor_finance_settings.base_currency`
2. Profile override
3. `FINANCE_DEFAULT_BASE_CURRENCY` / `FX_DEFAULT_BASE_CURRENCY`
4. Default **VND**

## Env

| Env | Meaning |
|---|---|
| `FX_PROVIDER=open-er-api` | Default live provider (KZT/VND/USD/…) |
| `FX_PROVIDER=frankfurter` | Composites open-er-api + Frankfurter |
| `FX_PROVIDER=test` | Deterministic in-process rates |
| `FX_PROVIDER=none` | No conversion (honest partial/unavailable) |
| `FINANCE_DEFAULT_BASE_CURRENCY` | Reporting currency |

## API

- `GET /api/finance/summary` — `baseCurrency`, `incomeBase`, `expenseBase`, `balanceBase`, `originalCurrencyTotals`, `fxStatus`, `ratesUpdatedAt`
- `GET /api/finance/settings`
- Dashboard uses **one** finance bundle (today summary + recent txs), not double summary.
