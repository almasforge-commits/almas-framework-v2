import { getApiHost, getApiMode, type ApiMode } from "../config/env";
import { getRawInitData } from "../telegram/initData";

export type ApiDiagSnapshot = {
  apiMode: ApiMode;
  apiHost: string | null;
  initDataPresent: boolean;
  endpoint: string | null;
  fetchAttempted: boolean;
  responseStatus: number | null;
  errorCategory: string | null;
};

let lastDiag: ApiDiagSnapshot = {
  apiMode: getApiMode(),
  apiHost: getApiHost(),
  initDataPresent: false,
  endpoint: null,
  fetchAttempted: false,
  responseStatus: null,
  errorCategory: null,
};

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
  };
  return getApiDiagSnapshot();
}

export function resetApiDiagForTests(): void {
  lastDiag = {
    apiMode: getApiMode(),
    apiHost: getApiHost(),
    initDataPresent: false,
    endpoint: null,
    fetchAttempted: false,
    responseStatus: null,
    errorCategory: null,
  };
}

export function formatApiDiagLine(diag: ApiDiagSnapshot = getApiDiagSnapshot()): string {
  const parts = [
    `apiMode=${diag.apiMode}`,
    `apiHost=${diag.apiHost ?? "unset"}`,
    `initDataPresent=${diag.initDataPresent}`,
  ];
  if (diag.endpoint) parts.push(`endpoint=${diag.endpoint}`);
  if (diag.fetchAttempted) parts.push(`fetchAttempted=true`);
  if (diag.responseStatus != null) parts.push(`status=${diag.responseStatus}`);
  if (diag.errorCategory) parts.push(`error=${diag.errorCategory}`);
  return `[mini-app] ${parts.join(" ")}`;
}

/**
 * Boot-time + request diagnostics. Safe for production Telegram WebViews.
 */
export function logApiDiag(partial?: Partial<ApiDiagSnapshot>): void {
  if (partial) recordApiDiag(partial);
  else {
    recordApiDiag({
      apiMode: getApiMode(),
      apiHost: getApiHost(),
      initDataPresent: Boolean(getRawInitData()),
    });
  }
  // eslint-disable-next-line no-console
  console.info(formatApiDiagLine());
}
