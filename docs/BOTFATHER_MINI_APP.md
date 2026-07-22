# BotFather — ALMAS Mini App domain & Menu Button

Code alone cannot register the Mini App with Telegram. After deploying the
HTTPS Mini App and setting `ALMAS_WEB_APP_URL` on the bot, complete these
BotFather steps once.

Production Mini App origin:

`https://almas-framework-v2-five.vercel.app`

## Why this matters

Authenticated Mini App launches require Telegram’s **`web_app`** button field
(or a BotFather Menu Button configured as a Web App). A normal link / `url`
button opens the page **without** `Telegram.WebApp.initData`, so the API
correctly shows:

> Откройте приложение через Telegram

## Exact steps (beginner-friendly)

1. Open Telegram and go to **@BotFather**.
2. Send `/mybots` and select the **ALMAS** bot.
3. Tap **Bot Settings**.
4. Tap **Menu Button** → **Configure menu button**.
5. Choose **Web App** (not a plain URL/command list only).
6. Set the Web App URL to exactly:

   `https://almas-framework-v2-five.vercel.app`

   (HTTPS, no path required for the menu root; `/finance` etc. come from
   in-bot `web_app` deep links.)
7. Confirm / save.
8. Optional but recommended: create/link a Mini App via BotFather
   (**Bot Settings** → **Configure Mini App** / `/newapp` if shown) and
   attach the same HTTPS domain `almas-framework-v2-five.vercel.app`.
9. Fully close the old Mini App window in Telegram Desktop.
10. Restart the bot process (so reply keyboards rebuild with `web_app`).
11. Open a **private** chat with the bot → press **🌐 Открыть ALMAS** or the
    inline **Open … →** button on a confirmation.

## Distinguish issues

| Symptom | Likely cause |
| --- | --- |
| Bundle has Railway URL but UI shows demo data | Vercel env / rebuild |
| UI shows auth-required, Railway has no API calls, `initDataPresent=false` | Opened without `web_app` launch **or** BotFather Menu/domain not set |
| Bot sends no Open buttons | `ALMAS_WEB_APP_URL` missing on the bot host |
| Group chat | Authenticated Mini App is private-chat only — open the bot in DM |

## Code vs BotFather

- **Code:** every Open ALMAS / Finance / Ideas / … button must use
  `createMiniAppButton` → `{ text, web_app: { url } }`.
- **BotFather:** Menu Button + domain registration for the production host.
- Production auth-required with a visual Telegram WebView almost always means
  **both** must be correct: real `web_app` buttons **and** BotFather Web App
  configuration for `almas-framework-v2-five.vercel.app`.
