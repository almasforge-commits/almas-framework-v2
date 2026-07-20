# ALMAS Telegram Mini App

Client-only presentation shell for viewing ALMAS data inside Telegram (and in a browser preview).

## Purpose

Provide a mobile-first Mini App UI with navigation, mock dashboard screens, Telegram WebApp theme integration, and a typed API boundary. **ALMAS Core / the Node bot remains the source of business logic.** This app does not own domain storage.

## Architecture

```
Telegram WebApp / Browser
        ↓
   mini-app/ (Vite + React + TypeScript)
        ↓
   apiClient → mockApi (v1) | future HTTPS ALMAS backend API
        ↓
   ALMAS Core services (bot) → Supabase / storage
```

- Presentation only: pages consume `apiClient`, never hardcode privileged storage access.
- Direct privileged Supabase access from the Mini App is **forbidden**.
- Current data is **mock / demo** only.

## Development

```bash
cd mini-app
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5173`).

## Build

```bash
cd mini-app
npm run typecheck
npm run test
npm run build
```

Static output lands in `mini-app/dist/` (gitignored).

## Browser preview

Works without Telegram:

- Fallback user (`Гость`)
- “Browser preview” indicator on Home
- Theme CSS fallbacks for light/dark

## Telegram preview requirements

1. Host the built app on a **public HTTPS** URL.
2. Open from Telegram (BotFather Mini App / `web_app` button), not only a desktop browser.
3. Telegram injects `window.Telegram.WebApp`; the app calls `ready()` and `expand()` when present.

## Future API connection

Planned backend routes (not called yet):

- `GET /api/dashboard`
- `GET /api/inbox`
- `GET /api/finance/summary`
- `GET /api/finance/transactions`
- `GET /api/tasks`
- `PATCH /api/tasks/:id`
- `GET /api/knowledge`

Swap `mockApi` behind `apiClient` for a real HTTP client. Pages should not need a rewrite.

## Telegram `initData` security rule

- `initDataUnsafe` is **display-only** (greeting / UI personalization).
- Never treat `initDataUnsafe` as authenticated server identity.
- Future authenticated requests must send the raw signed `initData` string to the ALMAS backend; the backend validates Telegram’s signature before trusting user identity.
- Never put bot tokens or Supabase service-role keys in the Mini App.

## Deployment (not done in Foundation v1)

1. Deploy `mini-app/dist` to a public **HTTPS** host.
2. Set `ALMAS_WEB_APP_URL=<that HTTPS URL>` in the bot environment (see `config/webapp.js`).
3. Later, the existing menu button **«🌐 Открыть ALMAS»** becomes a Telegram `web_app` button when the URL is valid.
4. Do not register with BotFather / do not set production URL until deliberately deploying.

Live Telegram menu behavior is unchanged until `ALMAS_WEB_APP_URL` is configured.
