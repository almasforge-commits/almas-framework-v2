import { getTelegramWebApp } from "../telegram/telegramWebApp";

const REJECTED_LITERALS = new Set([
  "null",
  "undefined",
  "[object object]",
]);

const STALE_INIT_DATA_KEYS = [
  "almas.initData",
  "almas.telegramInitData",
  "telegram_initData",
  "initData",
  "tma_initData",
];

/**
 * Strict client-side initData gate.
 * Does NOT validate HMAC — only rejects values that must never become Authorization.
 * Valid strings are returned unchanged (no decode / trim / rewrite).
 */
export function normalizeTelegramInitData(value: unknown): string {
  if (typeof value !== "string") return "";
  if (!value.trim()) return "";

  const lowered = value.trim().toLowerCase();
  if (REJECTED_LITERALS.has(lowered)) return "";

  // Real Telegram initData is a querystring with these markers.
  if (!value.includes("hash=")) return "";
  if (!value.includes("auth_date=")) return "";

  return value;
}

/**
 * Drop cached garbage that could reappear as Authorization: tma null.
 * Never stores initData itself — only clears known bad leftovers.
 */
export function clearStaleInitDataCache(): void {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      for (const key of STALE_INIT_DATA_KEYS) {
        const raw = storage.getItem(key);
        if (raw == null) continue;
        if (!normalizeTelegramInitData(raw)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // private mode / blocked storage
    }
  }
}

/**
 * Raw Telegram.WebApp.initData only — never initDataUnsafe.
 * Rejects literal "null" / "undefined" / marker-less junk.
 */
export function getRawInitData(
  getWebApp: typeof getTelegramWebApp = getTelegramWebApp
): string | null {
  const webApp = getWebApp();
  const raw = webApp?.initData;
  const normalized = normalizeTelegramInitData(raw);
  return normalized || null;
}

export function describeInitDataType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value;
}
