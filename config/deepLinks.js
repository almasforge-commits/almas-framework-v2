/**
 * Mini App deep-link helpers for Telegram confirmations.
 * Telegram stays thin; detail screens open in the Mini App.
 *
 * Paths are root-relative — the Mini App is deployed at domain root
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
 * Inline keyboard row that opens Mini App at a path (when configured).
 * @param {string} label
 * @param {string} path
 * @returns {object|null} button object or null
 */
export function buildMiniAppWebAppButton(label, path) {
  const url = buildMiniAppUrl(path);
  if (!url) return null;
  return { text: String(label || "Open ALMAS →"), web_app: { url } };
}

/**
 * Append Open ALMAS button to an existing inline keyboard.
 * @param {object} [replyMarkup]
 * @param {string} path
 * @param {string} [label]
 * @returns {object} reply_markup
 */
export function withMiniAppOpenButton(
  replyMarkup = {},
  path,
  label = "Open ALMAS →"
) {
  const button = buildMiniAppWebAppButton(label, path);
  const existing = replyMarkup?.reply_markup?.inline_keyboard
    ? replyMarkup.reply_markup.inline_keyboard.map((row) => row.slice())
    : [];

  if (button) {
    existing.push([button]);
  }

  return {
    reply_markup: {
      inline_keyboard: existing,
    },
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
});

/**
 * Build a thin Telegram reply payload (text + optional web_app button).
 * @param {string} text
 * @param {string} path
 * @param {string} [label]
 */
export function thinOpenReply(text, path, label = THIN_CONFIRM.openAlmas) {
  return {
    text: String(text || "").trim(),
    ...withMiniAppOpenButton({}, path, label),
  };
}
