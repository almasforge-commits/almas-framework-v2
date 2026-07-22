export type TelegramColorScheme = "light" | "dark";

export interface TelegramThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  /** Telegram client platform, e.g. "ios" | "android" | "tdesktop" | "web" */
  platform?: string;
  colorScheme?: TelegramColorScheme;
  themeParams?: TelegramThemeParams;
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramUser;
    auth_date?: number;
    hash?: string;
  };
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export {};
