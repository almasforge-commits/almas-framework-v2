import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TelegramUser, TelegramWebApp } from "./telegramTypes";
import {
  FALLBACK_USER,
  initTelegramWebApp,
  isInsideTelegram,
  readColorScheme,
  readDisplayUser,
  readThemeParams,
} from "./telegramWebApp";
import { applyTelegramTheme } from "../theme/telegramTheme";

interface TelegramContextValue {
  insideTelegram: boolean;
  browserPreview: boolean;
  user: TelegramUser;
  webApp: TelegramWebApp | null;
  colorScheme: "light" | "dark";
}

const TelegramContext = createContext<TelegramContextValue | null>(null);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [insideTelegram, setInsideTelegram] = useState(false);
  const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");
  const [user, setUser] = useState<TelegramUser>(FALLBACK_USER);

  useEffect(() => {
    const { webApp: nextWebApp, insideTelegram: inside } = initTelegramWebApp();
    setWebApp(nextWebApp);
    setInsideTelegram(inside || isInsideTelegram());

    const scheme = readColorScheme(nextWebApp);
    setColorScheme(scheme);
    setUser(readDisplayUser(nextWebApp));
    applyTelegramTheme(readThemeParams(nextWebApp), scheme);

    const onTheme = () => {
      const current = nextWebApp;
      const nextScheme = readColorScheme(current);
      setColorScheme(nextScheme);
      applyTelegramTheme(readThemeParams(current), nextScheme);
    };

    nextWebApp?.onEvent?.("themeChanged", onTheme);
    return () => {
      nextWebApp?.offEvent?.("themeChanged", onTheme);
    };
  }, []);

  const value = useMemo<TelegramContextValue>(
    () => ({
      insideTelegram,
      browserPreview: !insideTelegram,
      user,
      webApp,
      colorScheme,
    }),
    [insideTelegram, user, webApp, colorScheme]
  );

  return (
    <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>
  );
}

export function useTelegram(): TelegramContextValue {
  const ctx = useContext(TelegramContext);
  if (!ctx) {
    throw new Error("useTelegram must be used within TelegramProvider");
  }
  return ctx;
}
