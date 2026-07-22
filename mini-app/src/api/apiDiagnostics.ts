import { getApiHost, getApiMode, type ApiMode } from "../config/env";
import { getRawInitData } from "../telegram/initData";
import { getTelegramWebApp } from "../telegram/telegramWebApp";

export type ApiDiagSnapshot = {
  apiMode: ApiMode;
  apiHost: string | null;
  telegramSdkPresent: boolean;
  initDataPresent: boolean;
  launchPlatform: string | null;
  endpoint: string | null;
  fetchAttempted: boolean;
  responseStatus: number | null;
  errorCategory: string | null;
};

function readLaunchPlatform(): string | null {
  const webApp = getTelegramWebApp();
  const platform = webApp?.platform;
  return typeof platform === "string" && platform.trim()
    ? platform.trim()
    : null;
}

function readSdkPresent(): boolean {
  return Boolean(getTelegramWebApp());
}

function baseDiag(): ApiDiagSnapshot {
  return {
    apiMode: getApiMode(),
    apiHost: getApiHost(),
    telegramSdkPresent: readSdkPresent(),
    initDataPresent: Boolean(getRawInitData()),
    launchPlatform: readLaunchPlatform(),
    endpoint: null,
    fetchAttempted: false,
    responseStatus: null,
    errorCategory: null,
  };
}

let lastDiag: ApiDiagSnapshot = baseDiag();

/** Non-secret diagnostics only — never log initData, tokens, or auth headers. */
export function getApiDiagSnapshot(): ApiDiagSnapshot {
  return { ...lastDiag };
}

export function recordApiDiag(partial: Partial<ApiDiagSnapshot>): ApiDiagSnapshot {
  lastDiag = {
    ...lastDiag,
    ...partial,
    apiMode: partial.apiMode ?? lastDiag.apiMode,
    apiHost: partial.apiHost !== undefined ? partial.apiHost : lastDiag.apiHost,
    telegramSdkPresent:
      partial.telegramSdkPresent !== undefined
        ? partial.telegramSdkPresent
        : lastDiag.telegramSdkPresent,
    initDataPresent:
      partial.initDataPresent !== undefined
        ? partial.initDataPresent
        : lastDiag.initDataPresent,
    launchPlatform:
      partial.launchPlatform !== undefined
        ? partial.launchPlatform
        : lastDiag.launchPlatform,
  };
  return getApiDiagSnapshot();
}

export function resetApiDiagForTests(): void {
  lastDiag = baseDiag();
}

export function formatApiDiagLine(
  diag: ApiDiagSnapshot = getApiDiagSnapshot()
): string {
  const parts = [
    `apiMode=${diag.apiMode}`,
    `apiHost=${diag.apiHost ?? "unset"}`,
    `telegramSdkPresent=${diag.telegramSdkPresent}`,
    `initDataPresent=${diag.initDataPresent}`,
    `launchPlatform=${diag.launchPlatform ?? "unknown"}`,
  ];
  if (diag.endpoint) parts.push(`endpoint=${diag.endpoint}`);
  if (diag.fetchAttempted) parts.push(`fetchAttempted=true`);
  if (diag.responseStatus != null) parts.push(`status=${diag.responseStatus}`);
  if (diag.errorCategory) parts.push(`error=${diag.errorCategory}`);
  return `[mini-app] ${parts.join(" ")}`;
}

/**
 * Boot-time + request diagnostics. Safe for production Telegram WebViews.
 * Emits one line per call — never includes raw initData.
 */
export function logApiDiag(partial?: Partial<ApiDiagSnapshot>): void {
  const fresh = {
    apiMode: getApiMode(),
    apiHost: getApiHost(),
    telegramSdkPresent: readSdkPresent(),
    initDataPresent: Boolean(getRawInitData()),
    launchPlatform: readLaunchPlatform(),
  };
  recordApiDiag({ ...fresh, ...partial });
  // eslint-disable-next-line no-console
  console.info(formatApiDiagLine());
}

/** Multi-line boot dump for Telegram Desktop / mobile WebView consoles. */
export function logLaunchDiagnostics(): void {
  const diag = recordApiDiag({
    apiMode: getApiMode(),
    apiHost: getApiHost(),
    telegramSdkPresent: readSdkPresent(),
    initDataPresent: Boolean(getRawInitData()),
    launchPlatform: readLaunchPlatform(),
    endpoint: null,
    fetchAttempted: false,
    responseStatus: null,
    errorCategory: null,
  });
  // eslint-disable-next-line no-console
  console.info(`[mini-app] apiMode=${diag.apiMode}`);
  // eslint-disable-next-line no-console
  console.info(`[mini-app] apiHost=${diag.apiHost ?? "unset"}`);
  // eslint-disable-next-line no-console
  console.info(`[mini-app] telegramSdkPresent=${diag.telegramSdkPresent}`);
  // eslint-disable-next-line no-console
  console.info(`[mini-app] initDataPresent=${diag.initDataPresent}`);
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app] launchPlatform=${diag.launchPlatform ?? "unknown"}`
  );
}
