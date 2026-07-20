import type { TelegramThemeParams } from "../telegram/telegramTypes";

const LIGHT_FALLBACKS: Required<TelegramThemeParams> = {
  bg_color: "#ffffff",
  secondary_bg_color: "#f4f4f5",
  text_color: "#111827",
  hint_color: "#6b7280",
  link_color: "#2563eb",
  button_color: "#2563eb",
  button_text_color: "#ffffff",
};

const DARK_FALLBACKS: Required<TelegramThemeParams> = {
  bg_color: "#0f172a",
  secondary_bg_color: "#1e293b",
  text_color: "#f8fafc",
  hint_color: "#94a3b8",
  link_color: "#60a5fa",
  button_color: "#3b82f6",
  button_text_color: "#ffffff",
};

/**
 * Maps Telegram theme params to CSS variables on :root.
 */
export function applyTelegramTheme(
  themeParams: TelegramThemeParams,
  colorScheme: "light" | "dark" = "light"
): void {
  if (typeof document === "undefined") return;

  const fallbacks = colorScheme === "dark" ? DARK_FALLBACKS : LIGHT_FALLBACKS;
  const root = document.documentElement;

  root.style.setProperty("--tg-bg", themeParams.bg_color || fallbacks.bg_color);
  root.style.setProperty(
    "--tg-secondary-bg",
    themeParams.secondary_bg_color || fallbacks.secondary_bg_color
  );
  root.style.setProperty(
    "--tg-text",
    themeParams.text_color || fallbacks.text_color
  );
  root.style.setProperty(
    "--tg-hint",
    themeParams.hint_color || fallbacks.hint_color
  );
  root.style.setProperty(
    "--tg-link",
    themeParams.link_color || fallbacks.link_color
  );
  root.style.setProperty(
    "--tg-button",
    themeParams.button_color || fallbacks.button_color
  );
  root.style.setProperty(
    "--tg-button-text",
    themeParams.button_text_color || fallbacks.button_text_color
  );

  root.dataset.colorScheme = colorScheme;
}

export function mapThemeToCssVariables(
  themeParams: TelegramThemeParams,
  colorScheme: "light" | "dark" = "light"
): Record<string, string> {
  const fallbacks = colorScheme === "dark" ? DARK_FALLBACKS : LIGHT_FALLBACKS;
  return {
    "--tg-bg": themeParams.bg_color || fallbacks.bg_color,
    "--tg-secondary-bg":
      themeParams.secondary_bg_color || fallbacks.secondary_bg_color,
    "--tg-text": themeParams.text_color || fallbacks.text_color,
    "--tg-hint": themeParams.hint_color || fallbacks.hint_color,
    "--tg-link": themeParams.link_color || fallbacks.link_color,
    "--tg-button": themeParams.button_color || fallbacks.button_color,
    "--tg-button-text":
      themeParams.button_text_color || fallbacks.button_text_color,
  };
}
