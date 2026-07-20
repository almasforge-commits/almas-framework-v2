import { getTelegramWebApp } from "../telegram/telegramWebApp";

/**
 * Raw Telegram.WebApp.initData only — never initDataUnsafe.
 */
export function getRawInitData(
  getWebApp: typeof getTelegramWebApp = getTelegramWebApp
): string | null {
  const webApp = getWebApp();
  const raw = webApp?.initData;
  if (typeof raw === "string" && raw.trim()) return raw;
  return null;
}
