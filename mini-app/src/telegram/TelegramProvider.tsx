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
  getTelegramWebApp,
  initTelegramWebApp,
  isInsideTelegram,
  readColorScheme,
  readDisplayUser,
  readThemeParams,
} from "./telegramWebApp";
import {
  clearStaleInitDataCache,
  describeInitDataType,
  getRawInitData,
  normalizeTelegramInitData,
} from "./initData";
import { applyTelegramTheme } from "../theme/telegramTheme";
import { isMockMode } from "../config/env";

export type AuthBootstrapStatus = "pending" | "ready" | "missing";

interface TelegramContextValue {
  insideTelegram: boolean;
  browserPreview: boolean;
  user: TelegramUser;
  webApp: TelegramWebApp | null;
  colorScheme: "light" | "dark";
  /** Live auth bootstrap: wait before firing /api/dashboard. */
  authStatus: AuthBootstrapStatus;
}

const TelegramContext = createContext<TelegramContextValue | null>(null);

const BOOTSTRAP_ATTEMPTS = 6;
const BOOTSTRAP_RETRY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logAuthBootstrap(opts: {
  telegramSdkPresent: boolean;
  webAppPresent: boolean;
  initDataType: string;
  initDataPresent: boolean;
  initDataLength: number;
  hashMarkerPresent: boolean;
  authDateMarkerPresent: boolean;
  authHeaderBuilt: boolean;
  launchPlatform: string;
  authStatus: AuthBootstrapStatus;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] telegramSdkPresent=${opts.telegramSdkPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] webAppPresent=${opts.webAppPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(`[mini-app-auth] initDataType=${opts.initDataType}`);
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] initDataPresent=${opts.initDataPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(`[mini-app-auth] initDataLength=${opts.initDataLength}`);
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] hashMarkerPresent=${opts.hashMarkerPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] authDateMarkerPresent=${opts.authDateMarkerPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] authHeaderBuilt=${opts.authHeaderBuilt ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(`[mini-app-auth] launchPlatform=${opts.launchPlatform}`);
  // eslint-disable-next-line no-console
  console.info(`[mini-app-auth] authStatus=${opts.authStatus}`);
}

async function waitForValidInitData(): Promise<string | null> {
  clearStaleInitDataCache();
  for (let i = 0; i < BOOTSTRAP_ATTEMPTS; i += 1) {
    initTelegramWebApp();
    const value = getRawInitData();
    if (value) return value;
    if (i < BOOTSTRAP_ATTEMPTS - 1) {
      await sleep(BOOTSTRAP_RETRY_MS);
    }
  }
  return null;
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [insideTelegram, setInsideTelegram] = useState(false);
  const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");
  const [user, setUser] = useState<TelegramUser>(FALLBACK_USER);
  const [authStatus, setAuthStatus] = useState<AuthBootstrapStatus>(() =>
    isMockMode() ? "ready" : "pending"
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      clearStaleInitDataCache();
      const { webApp: nextWebApp, insideTelegram: inside } = initTelegramWebApp();
      if (cancelled) return;

      setWebApp(nextWebApp);
      setInsideTelegram(inside || isInsideTelegram());

      const scheme = readColorScheme(nextWebApp);
      setColorScheme(scheme);
      setUser(readDisplayUser(nextWebApp));
      applyTelegramTheme(readThemeParams(nextWebApp), scheme);

      if (isMockMode()) {
        setAuthStatus("ready");
        logAuthBootstrap({
          telegramSdkPresent: Boolean(getTelegramWebApp()),
          webAppPresent: Boolean(nextWebApp),
          initDataType: describeInitDataType(nextWebApp?.initData),
          initDataPresent: false,
          initDataLength: 0,
          hashMarkerPresent: false,
          authDateMarkerPresent: false,
          authHeaderBuilt: false,
          launchPlatform:
            typeof nextWebApp?.platform === "string" && nextWebApp.platform
              ? nextWebApp.platform
              : "unknown",
          authStatus: "ready",
        });
        return;
      }

      const initData = await waitForValidInitData();
      if (cancelled) return;

      const rawType = describeInitDataType(nextWebApp?.initData);
      const rawString =
        typeof nextWebApp?.initData === "string" ? nextWebApp.initData : "";
      const status: AuthBootstrapStatus = initData ? "ready" : "missing";
      setAuthStatus(status);

      logAuthBootstrap({
        telegramSdkPresent: Boolean(getTelegramWebApp()),
        webAppPresent: Boolean(getTelegramWebApp()),
        initDataType: rawType,
        initDataPresent: Boolean(initData),
        initDataLength: initData ? initData.length : rawString.length,
        hashMarkerPresent: Boolean(initData) || rawString.includes("hash="),
        authDateMarkerPresent:
          Boolean(initData) || rawString.includes("auth_date="),
        // Header is never built during bootstrap — only after validate.
        authHeaderBuilt: false,
        launchPlatform:
          typeof getTelegramWebApp()?.platform === "string" &&
          getTelegramWebApp()?.platform
            ? String(getTelegramWebApp()?.platform)
            : "unknown",
        authStatus: status,
      });

      // Defensive: if bridge exposed literal "null", treat as missing.
      if (
        typeof nextWebApp?.initData === "string" &&
        !normalizeTelegramInitData(nextWebApp.initData)
      ) {
        clearStaleInitDataCache();
      }
    };

    void run();

    const onTheme = () => {
      const current = getTelegramWebApp();
      const nextScheme = readColorScheme(current);
      setColorScheme(nextScheme);
      applyTelegramTheme(readThemeParams(current), nextScheme);
    };

    const wa = getTelegramWebApp();
    wa?.onEvent?.("themeChanged", onTheme);
    return () => {
      cancelled = true;
      wa?.offEvent?.("themeChanged", onTheme);
    };
  }, []);

  const value = useMemo<TelegramContextValue>(
    () => ({
      insideTelegram,
      browserPreview: !insideTelegram,
      user,
      webApp,
      colorScheme,
      authStatus,
    }),
    [insideTelegram, user, webApp, colorScheme, authStatus]
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
