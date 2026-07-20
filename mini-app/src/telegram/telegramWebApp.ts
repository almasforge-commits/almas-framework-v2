import type {
  TelegramThemeParams,
  TelegramUser,
  TelegramWebApp,
} from "./telegramTypes";

export const FALLBACK_USER: TelegramUser = {
  id: 0,
  first_name: "Гость",
  username: "browser_preview",
};

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function isInsideTelegram(): boolean {
  const webApp = getTelegramWebApp();
  return Boolean(webApp && typeof webApp.ready === "function");
}

/**
 * Initializes the Telegram WebApp bridge when available.
 * Safe in browser preview — no-ops when Telegram is missing.
 *
 * Security: initDataUnsafe is display-only. Future backend auth must
 * validate the signed raw initData string server-side — never trust
 * initDataUnsafe as identity.
 */
export function initTelegramWebApp(): {
  webApp: TelegramWebApp | null;
  insideTelegram: boolean;
} {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return { webApp: null, insideTelegram: false };
  }

  try {
    webApp.ready?.();
  } catch {
    // ignore missing bridge methods
  }

  try {
    webApp.expand?.();
  } catch {
    // ignore
  }

  return { webApp, insideTelegram: true };
}

export function readDisplayUser(webApp: TelegramWebApp | null): TelegramUser {
  const user = webApp?.initDataUnsafe?.user;
  if (user?.first_name) return user;
  return FALLBACK_USER;
}

export function readThemeParams(
  webApp: TelegramWebApp | null
): TelegramThemeParams {
  return webApp?.themeParams ?? {};
}

export function readColorScheme(
  webApp: TelegramWebApp | null
): "light" | "dark" {
  return webApp?.colorScheme === "dark" ? "dark" : "light";
}
