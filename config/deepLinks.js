/**
 * Mini App deep-link helpers for Telegram confirmations.
 * Telegram stays thin; detail screens open in the Mini App.
 *
 * Authenticated launches MUST use KeyboardButton/InlineKeyboardButton
 * field `web_app: { url }` — never plain `url` (that opens without initData).
 *
 * Paths are root-relative — Mini App is at domain root
 * (e.g. https://….vercel.app/finance), not under /almas.
 */

import { ALMAS_WEB_APP_URL, isValidWebAppUrl } from "./webapp.js";

/** Canonical Mini App paths (domain root). */
export const MINI_APP_PATHS = Object.freeze({
  home: "/",
  inbox: "/inbox",
  finance: "/finance",
  tasks: "/tasks",
  knowledge: "/knowledge",
  ideas: "/ideas",
  memory: "/memory",
  capture: "/capture",
  more: "/more",
});

/**
 * @param {string|null|undefined} chatType
 * @returns {boolean}
 */
export function isPrivateChatType(chatType) {
  const t = String(chatType || "private").toLowerCase();
  return t === "private";
}

/**
 * @param {string} path - absolute Mini App path, e.g. "/finance"
 * @param {string|null} [baseUrl]
 * @returns {string|null} https URL or null when Mini App is not configured
 */
export function buildMiniAppUrl(path, baseUrl = ALMAS_WEB_APP_URL) {
  if (!isValidWebAppUrl(baseUrl)) return null;
  const base = String(baseUrl).replace(/\/+$/, "");
  let suffix = String(path == null || path === "" ? "/" : path);
  if (!suffix.startsWith("/")) suffix = `/${suffix}`;
  try {
    return new URL(suffix, `${base}/`).toString();
  } catch {
    return null;
  }
}

/**
 * @param {string} [ideaId]
 * @returns {string}
 */
export function ideasPath(ideaId = null) {
  if (ideaId) {
    return `${MINI_APP_PATHS.ideas}/${encodeURIComponent(String(ideaId))}`;
  }
  return MINI_APP_PATHS.ideas;
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function capturePath(sessionId) {
  return `${MINI_APP_PATHS.capture}/${encodeURIComponent(String(sessionId || ""))}`;
}

/**
 * Shared helper: authenticated Mini App button (Telegram Web App launch).
 *
 * @param {{ text: string, path?: string, baseUrl?: string|null }} opts
 * @returns {{ text: string, web_app: { url: string } }|null}
 *
 * Never returns `{ text, url }` — that would open without initData.
 */
export function createMiniAppButton(opts = {}) {
  const text = String(opts.text || "Open ALMAS →").trim() || "Open ALMAS →";
  const path = opts.path == null || opts.path === "" ? "/" : opts.path;
  const baseUrl =
    opts.baseUrl === undefined ? ALMAS_WEB_APP_URL : opts.baseUrl;
  const url = buildMiniAppUrl(path, baseUrl);
  if (!url) return null;
  return {
    text,
    web_app: { url },
  };
}

/**
 * @param {string} label
 * @param {string} path
 * @param {string|null} [baseUrl]
 * @returns {object|null}
 */
export function buildMiniAppWebAppButton(label, path, baseUrl) {
  return createMiniAppButton({
    text: label,
    path,
    baseUrl,
  });
}

/**
 * True when a button is a genuine Web App launch button (not a plain url).
 * @param {object|null|undefined} button
 */
export function isWebAppLaunchButton(button) {
  if (!button || typeof button !== "object") return false;
  const webAppUrl = button.web_app?.url;
  if (typeof webAppUrl !== "string" || !webAppUrl) return false;
  // Reject accidental plain-url Mini App launches.
  if (typeof button.url === "string" && button.url) return false;
  return isValidWebAppUrl(webAppUrl);
}

/**
 * Strip web_app buttons from markup when chat type cannot host authenticated
 * Mini Apps (groups/channels). Leaves callback / plain text buttons.
 * Does not convert web_app → url (that would leak an unauthenticated open).
 *
 * @param {object|null|undefined} replyMarkup
 * @param {string|null|undefined} chatType
 * @returns {object|null|undefined}
 */
export function sanitizeMiniAppMarkupForChat(replyMarkup, chatType) {
  if (!replyMarkup || isPrivateChatType(chatType)) return replyMarkup;

  const stripRow = (row) =>
    (Array.isArray(row) ? row : [])
      .filter((btn) => btn && !btn.web_app)
      .map((btn) => {
        // Defensive: never allow plain url pointing at Mini App host.
        if (btn.url && isLikelyMiniAppUrl(btn.url)) {
          const { url: _drop, ...rest } = btn;
          return rest.text ? { text: rest.text } : null;
        }
        return btn;
      })
      .filter(Boolean);

  if (Array.isArray(replyMarkup.inline_keyboard)) {
    const inline_keyboard = replyMarkup.inline_keyboard
      .map(stripRow)
      .filter((row) => row.length > 0);
    return { ...replyMarkup, inline_keyboard };
  }

  if (Array.isArray(replyMarkup.keyboard)) {
    const keyboard = replyMarkup.keyboard.map((row) =>
      (Array.isArray(row) ? row : []).map((btn) => {
        if (!btn?.web_app) return btn;
        return { text: btn.text || "ALMAS" };
      })
    );
    return { ...replyMarkup, keyboard };
  }

  return replyMarkup;
}

function isLikelyMiniAppUrl(url) {
  try {
    if (!ALMAS_WEB_APP_URL) return /vercel\.app/i.test(String(url));
    const host = new URL(ALMAS_WEB_APP_URL).host;
    return new URL(String(url)).host === host;
  } catch {
    return false;
  }
}

/**
 * Append Open ALMAS web_app button to an existing inline keyboard.
 * @param {object} [replyMarkup]
 * @param {string} path
 * @param {string} [label]
 * @param {{ baseUrl?: string|null, chatType?: string|null }} [options]
 * @returns {object} reply_markup
 */
export function withMiniAppOpenButton(
  replyMarkup = {},
  path,
  label = "Open ALMAS →",
  options = {}
) {
  const chatType = options.chatType;
  const button = isPrivateChatType(chatType)
    ? createMiniAppButton({
        text: label,
        path,
        baseUrl: options.baseUrl,
      })
    : null;

  const existing = replyMarkup?.reply_markup?.inline_keyboard
    ? replyMarkup.reply_markup.inline_keyboard.map((row) => row.slice())
    : replyMarkup?.inline_keyboard
      ? replyMarkup.inline_keyboard.map((row) => row.slice())
      : [];

  if (button) {
    existing.push([button]);
  }

  return {
    reply_markup: sanitizeMiniAppMarkupForChat(
      { inline_keyboard: existing },
      chatType
    ),
  };
}

/**
 * Short Telegram confirmation copy (no dashboards).
 */
export const THIN_CONFIRM = Object.freeze({
  idea: "💡 Idea saved.",
  memory: "🧠 Saved.",
  finance: "💰 Updated.",
  task: "✅ Task saved.",
  found: "🧠 Found.",
  notFound: "🧠 Nothing found.",
  captureReady: "Captured",
  captureSaved: "✅ Saved.",
  openAlmas: "Open ALMAS →",
  openFinance: "Open Finance →",
  openIdeas: "Open Ideas →",
  openTasks: "Open Tasks →",
  openKnowledge: "Open Knowledge →",
  openMemory: "Open Memory →",
  review: "Review →",
  openPrivately:
    "Откройте ALMAS в личном чате с ботом — авторизованная Mini App доступна только в private chat.",
});

/**
 * Build a thin Telegram reply payload (text + optional web_app button).
 * @param {string} text
 * @param {string} path
 * @param {string} [label]
 * @param {{ chatType?: string|null, baseUrl?: string|null }} [options]
 */
export function thinOpenReply(
  text,
  path,
  label = THIN_CONFIRM.openAlmas,
  options = {}
) {
  if (!isPrivateChatType(options.chatType)) {
    return {
      text: `${String(text || "").trim()}\n\n${THIN_CONFIRM.openPrivately}`.trim(),
      reply_markup: { inline_keyboard: [] },
    };
  }

  return {
    text: String(text || "").trim(),
    ...withMiniAppOpenButton({}, path, label, options),
  };
}
