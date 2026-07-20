// Configuration for the optional ALMAS Web App entry point. Safe unset
// default: if ALMAS_WEB_APP_URL is missing or invalid, ALMAS_WEB_APP_URL
// below is null and the main menu's "🌐 Открыть ALMAS" button falls back
// to a plain "not connected yet" text reply — no .env change is needed
// for the bot to keep working exactly as before.

export function isValidWebAppUrl(url) {
  if (!url || typeof url !== "string") return false;

  try {
    // Telegram only allows https:// URLs for web_app buttons.
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const rawUrl = process.env.ALMAS_WEB_APP_URL || null;

export const ALMAS_WEB_APP_URL = isValidWebAppUrl(rawUrl) ? rawUrl : null;
