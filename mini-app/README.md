# ALMAS Telegram Mini App

Client-only presentation shell for viewing ALMAS data inside Telegram (and in a browser preview).

## Purpose

Provide a mobile-first Mini App UI with navigation, Telegram WebApp theme integration, and a typed API boundary. **ALMAS Core / the Node bot remains the source of business logic.** This app does not own domain storage.

## Architecture

```
Telegram WebApp / Browser
        ↓
   mini-app/ (Vite + React + TypeScript)
        ↓
   apiClient → mockApi (default) | realApi (live)
        ↓
   ALMAS read-only HTTP API (npm run api)
        ↓
   ALMAS Core services → Supabase / storage
```

- Pages consume `apiClient` only — they do not know mock vs live.
- Direct privileged Supabase access from the Mini App is **forbidden**.
- Bot token and Supabase service-role keys must never appear in the Mini App.

## Configuration

Vite env (use `.env.local`, gitignored — do not commit secrets):

| Variable | Default | Meaning |
|----------|---------|---------|
| `VITE_ALMAS_API_MODE` | `mock` | `mock` or `live` |
| `VITE_ALMAS_API_URL` | empty | Base URL of the read-only API (e.g. `http://127.0.0.1:8787`) |

See `.env.example`.

## Development (mock — default)

```bash
cd mini-app
npm install
npm run dev
```

Open `http://localhost:5173`. Demo data loads without Telegram or the API process.

## Local live verification

Terminal A (bot repo root):

```bash
npm run api
```

Terminal B:

```bash
cd mini-app
# create .env.local (not committed):
# VITE_ALMAS_API_MODE=live
# VITE_ALMAS_API_URL=http://127.0.0.1:8787
npm run dev
```

- Browser without Telegram: shows **«Откройте приложение через Telegram»** (auth-required), no crash.
- Inside Telegram with valid `initData`: requests use `Authorization: tma <raw initData>` only.
- CORS: set `ALMAS_API_CORS_ORIGIN=http://localhost:5173` on the API process when needed (server env, not Mini App).

## Build / test

```bash
cd mini-app
npm run typecheck
npm run test
npm run build
```

## Auth security

- Send **only** raw `window.Telegram.WebApp.initData` as `Authorization: tma <rawInitData>` (ALMAS API convention).
- Never send `initDataUnsafe`, user-id headers, cookies, or query identity.
- Backend validates HMAC; client never trusts unsafe display fields as identity.

## Error UX

| Condition | UI |
|-----------|-----|
| 401 / missing initData | Откройте приложение через Telegram |
| 503 | Данные временно недоступны |
| Network | Retry state |
| Malformed envelope | Controlled error (no raw server text) |

## Read-only

No PATCH/POST from the Mini App. Task checkboxes update local React state only in mock; live `patchTask` is a no-op.

## Future deployment

1. Deploy `mini-app/dist` to public HTTPS (Vercel Root Directory = `mini-app`).
2. Deploy the ALMAS API (`npm run api` / `node api/server.js`) to Railway/Render with public HTTPS.
3. Set Vercel env (then **Redeploy** — Vite embeds at build time):
   - `VITE_ALMAS_API_MODE=live`
   - `VITE_ALMAS_API_URL=https://<your-public-api-host>`
4. Set API env `ALMAS_API_CORS_ORIGIN=https://almas-framework-v2-five.vercel.app` (exact Mini App origin).
5. Set bot `ALMAS_WEB_APP_URL` to the Mini App HTTPS URL and restart the bot.
6. Apply Supabase migration `0006_create_capture_sessions.sql` before relying on Capture review across bot/API processes.
