# ALMAS read-only Mini App API

Separate Express **HTTP** process that serves authenticated, actor-scoped GET endpoints for the Telegram Mini App. Production HTTPS is expected from the deployment proxy/platform — this process does not terminate TLS itself.

## Purpose

- Expose ALMAS data to the Mini App without putting Supabase or bot secrets in the browser
- Validate Telegram WebApp **raw `initData`** on the server with the official bot-token HMAC algorithm
- Never trust `initDataUnsafe` or client-supplied user IDs

## Process model

| Process | Command | Role |
|---------|---------|------|
| Bot (polling) | `npm start` | Unchanged Telegram long polling |
| API | `npm run api` | Read-only HTTP API (`127.0.0.1:8787` by default) |

## Auth (ALMAS convention)

```
Authorization: tma <raw Telegram.WebApp.initData>
```

This header scheme is an **ALMAS API convention**, not an official Telegram HTTP requirement.

No alternative identity source is accepted: query params, JSON body, cookies, `initDataUnsafe`, or user-id headers.

Validation uses the official bot-token HMAC (not third-party Ed25519). All auth failures return the same generic body:

```json
{ "error": { "code": "unauthorized", "message": "Unauthorized" } }
```

Server logs may include a concise reason code only — never raw initData, hash, bot token, or user JSON.

## Response envelopes

Success:

```json
{ "data": ... }
```

List success:

```json
{
  "data": [],
  "meta": { "limit": 20, "offset": 0, "hasMore": false }
}
```

Error:

```json
{ "error": { "code": "unauthorized", "message": "Unauthorized" } }
```

Query limits: `limit` default 20 max 100; `offset` default 0; `period` ∈ `today|week|month`.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | No |
| GET | `/api/dashboard` | Yes |
| GET | `/api/inbox` | Yes |
| GET | `/api/finance/summary?period=` | Yes |
| GET | `/api/finance/transactions?period=&limit=&offset=` | Yes |
| GET | `/api/tasks` | Yes |
| GET | `/api/knowledge` | Yes |

POST/PUT/PATCH/DELETE are not registered.

## Actor scoping (fail closed)

- **Finance:** `user_id = String(telegramUserId)`
- **Inbox:** authoritative `actor_key = telegram:<id>` (+ optional `telegram_user_id`); does **not** depend on `INBOX_ENABLED`. `[]` only on successful empty query; read failures → `503`
- **Tasks / Knowledge:** `[]` with internal reason `ownership_not_available` until ownership can be enforced at query level
- **Dashboard:** aggregates only scoped reader outputs

## Supabase / RLS limitation

Application-level filters are required but **do not replace database RLS**. Current anon-style RLS may still allow broad table access for the service role/client. A future migration must add proper per-user ownership/RLS before multi-user production use. No schema migration in this milestone.

## Environment (optional; `.env` not modified by this milestone)

| Variable | Default | Meaning |
|----------|---------|---------|
| `BOT_TOKEN` | (required) | Telegram bot token for initData HMAC |
| `SUPABASE_URL` | (required for live reads) | Supabase project URL |
| `SUPABASE_ANON_KEY` | (required for live reads) | Supabase anon/service key used by Node drivers |
| `ALMAS_API_HOST` | `127.0.0.1` local / `0.0.0.0` when `PORT` set | Bind host |
| `ALMAS_API_PORT` | `8787` | Local port when `PORT` unset |
| `PORT` | (hosting-provided) | Public platform port (Railway/Render) — preferred when set |
| `ALMAS_API_CORS_ORIGIN` | unset | Comma-separated allowlist (no `*`), e.g. Mini App HTTPS origin |

## Hosted start

```bash
# Railway / Render start command (Procfile / railway.toml):
node api/server.js
# Health: GET /health  and  GET /api/health
```

## Local run

```bash
cd Code/telegram-bot
npm run api
curl -s http://127.0.0.1:8787/api/health
```

## Tests

```bash
node scripts/test-api-validate-init-data.js
node scripts/test-api-auth-middleware.js
node scripts/test-api-routes-readonly.js
node scripts/test-api-actor-scoping.js
node scripts/test-api-boundary.js
```
