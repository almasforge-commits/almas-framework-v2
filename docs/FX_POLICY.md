# Multi-currency FX (Finance summaries)

## Policy

1. **Original transactions are never rewritten.** Amounts/currencies in `finance_transactions` stay as captured.
2. **Conversion is for summaries/analytics only** (`/api/finance/summary`, Dashboard totals).
3. **Current period / Dashboard** uses the **latest cached** exchange rate for the day.
4. **Historical reports** (when supported) should use the closest `effective_at <= transaction date`.
5. Generated analytics may include `ratesUsed[]` / `ratesUpdatedAt` on the summary DTO.

## Base currency resolution

Priority:

1. Saved preference in `actor_finance_settings.base_currency` (when migration applied + loader wired)
2. Injected finance profile setting
3. Env `FINANCE_DEFAULT_BASE_CURRENCY` or `FX_DEFAULT_BASE_CURRENCY`
4. Documented default: **VND**

Never infer base currency solely from the last transaction.

## Provider / cache

| Env | Meaning |
|---|---|
| `FX_PROVIDER=none` | Default. No external calls. Multi-currency → `fxStatus=unavailable` or `partial` honestly. |
| `FX_PROVIDER=test` | Deterministic in-process rates (tests / staging). No network. |
| `FX_PROVIDER=frankfurter` | Optional live ECB-based rates via Frankfurter (server-side only, no API key). |
| `FX_TEST_RATES` | Optional overrides for test provider, e.g. `USD:KZT:450,USD:VND:25000` |
| `FINANCE_DEFAULT_BASE_CURRENCY` | Default reporting currency (default `VND`) |

Rates are cached in-process (`services/fx/fxCache.js`). Do not call an external provider once per transaction.

## Status honesty

- `ok` — all currencies convertible (or single currency)
- `partial` — some currencies converted; others missing rates (warning in UI)
- `unavailable` — no usable rates for foreign currencies; **do not fake a combined total**

## Migration

File: `supabase/migrations/0007_actor_finance_settings_and_fx_rates.sql`

Apply manually in Supabase SQL editor (do not auto-apply from the bot).

## API

- `GET /api/finance/summary` — includes `baseCurrency`, `incomeBase`, `expenseBase`, `balanceBase`, `originalCurrencyTotals`, `fxStatus`, `ratesUpdatedAt`
- `GET /api/finance/settings` — read-only settings hook (`baseCurrency`, `source`)
- `GET /api/dashboard` — summary includes `baseCurrency`, `fxStatus`, converted `expensesToday`

Transaction list endpoints are unchanged (original currency per row).
