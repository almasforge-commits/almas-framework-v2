import { ApiError } from "./apiErrors";
import { recordApiDiag } from "./apiDiagnostics";
import { joinApiUrl } from "../config/env";
import {
  describeInitDataType,
  getRawInitData,
  normalizeTelegramInitData,
} from "../telegram/initData";
import {
  getTelegramWebApp,
  initTelegramWebApp,
} from "../telegram/telegramWebApp";

export type FetchLike = typeof fetch;

export interface LiveHttpDeps {
  baseUrl: string;
  fetchFn?: FetchLike;
  getInitData?: () => string | null;
  /** Test-only: skip / shorten initData retry delay. */
  initDataRetryMs?: number;
  /** Test-only: bound initData poll attempts (default 5). */
  initDataAttempts?: number;
}

/**
 * Build Authorization only from already-normalized initData.
 * Rejects "null" / junk even if callers skip normalize.
 * Never coerce nullable values into the Authorization header.
 */
export function buildAuthHeader(initData: string): string {
  const normalized = normalizeTelegramInitData(initData);
  if (!normalized) {
    throw new ApiError("auth_required", "Telegram initData is required", {
      status: 401,
      retryable: false,
    });
  }
  // Prefix only — preserve every character of raw Telegram.WebApp.initData.
  return `tma ${normalized}`;
}

/** Safe client auth diagnostics — never logs raw initData or Authorization. */
export function logMiniAppAuthDiag(opts: {
  telegramSdkPresent: boolean;
  webAppPresent?: boolean;
  initDataType?: string;
  initDataPresent: boolean;
  initDataLength: number;
  hashMarkerPresent?: boolean;
  authDateMarkerPresent?: boolean;
  authHeaderBuilt: boolean;
  launchPlatform?: string | null;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] telegramSdkPresent=${opts.telegramSdkPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] webAppPresent=${
      opts.webAppPresent === undefined
        ? String(opts.telegramSdkPresent)
        : opts.webAppPresent
          ? "true"
          : "false"
    }`
  );
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] initDataType=${opts.initDataType ?? "unknown"}`
  );
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
  console.info(
    `[mini-app-auth] launchPlatform=${opts.launchPlatform ?? "unknown"}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read initData after ensuring WebApp.ready().
 * Bounded retries help Telegram Desktop when the bridge fills initData
 * slightly after first paint. Never accepts literal "null".
 */
export async function resolveInitDataForRequest(
  getInitData: () => string | null | undefined,
  retryMs = 120,
  attempts = 5
): Promise<string | null> {
  const maxAttempts = Math.max(1, attempts);
  for (let i = 0; i < maxAttempts; i += 1) {
    initTelegramWebApp();
    const value = normalizeTelegramInitData(getInitData());
    if (value) return value;
    if (i < maxAttempts - 1 && retryMs > 0) {
      await sleep(retryMs);
    }
  }
  return null;
}

function pathOnly(path: string): string {
  const q = path.indexOf("?");
  return q >= 0 ? path.slice(0, q) : path;
}

function logLiveHttpFailure(opts: {
  phase: string;
  url: string;
  method: string;
  status?: number | null;
  error?: unknown;
  bodyText?: string | null;
}): void {
  const err = opts.error;
  const message =
    err instanceof Error
      ? err.message
      : err != null
        ? String(err)
        : "";
  const status = opts.status == null ? "none" : String(opts.status);
  const body =
    opts.bodyText && opts.bodyText.trim()
      ? ` body=${opts.bodyText.slice(0, 160)}`
      : "";
  // eslint-disable-next-line no-console
  console.error(
    `[mini-app-http] phase=${opts.phase} method=${opts.method} status=${status} url=${opts.url}${message ? ` error=${message}` : ""}${body}`
  );
}

function readLaunchPlatform(): string {
  const platform = getTelegramWebApp()?.platform;
  return typeof platform === "string" && platform.trim()
    ? platform.trim()
    : "unknown";
}

function authDiagFromRaw(initData: string | null) {
  const webApp = getTelegramWebApp();
  const raw = webApp?.initData;
  const rawString = typeof raw === "string" ? raw : "";
  return {
    telegramSdkPresent: Boolean(webApp),
    webAppPresent: Boolean(webApp),
    initDataType: describeInitDataType(raw),
    initDataPresent: Boolean(initData),
    // Length of normalized value when valid; otherwise length of raw junk
    // (e.g. "null" → 4) without logging the payload itself.
    initDataLength: initData ? initData.length : rawString.length,
    hashMarkerPresent: Boolean(initData) || rawString.includes("hash="),
    authDateMarkerPresent:
      Boolean(initData) || rawString.includes("auth_date="),
    authHeaderBuilt: false,
    launchPlatform: readLaunchPlatform(),
  };
}

/**
 * Authenticated GET against the ALMAS read-only API.
 * Sends only Authorization: tma <rawInitData>.
 */
export async function liveGetJson<T>(
  path: string,
  deps: LiveHttpDeps
): Promise<T> {
  const endpoint = pathOnly(path);
  let url: string;
  try {
    url = joinApiUrl(deps.baseUrl, path);
  } catch (error) {
    recordApiDiag({
      apiHost: null,
      endpoint,
      fetchAttempted: false,
      initDataPresent: false,
      responseStatus: null,
      errorCategory: "unavailable",
    });
    logLiveHttpFailure({
      phase: "join_url",
      url: String(deps.baseUrl || "") + path,
      method: "GET",
      error,
    });
    throw new ApiError("unavailable", "API URL is not configured", {
      retryable: false,
    });
  }

  const getInitData = deps.getInitData ?? getRawInitData;
  const retryMs = deps.initDataRetryMs ?? 120;
  const attempts = deps.initDataAttempts ?? (retryMs <= 0 ? 1 : 5);
  const initData = await resolveInitDataForRequest(
    getInitData,
    retryMs,
    attempts
  );

  if (!initData) {
    logMiniAppAuthDiag(authDiagFromRaw(null));
    recordApiDiag({
      apiHost: (() => {
        try {
          return new URL(url).host;
        } catch {
          return null;
        }
      })(),
      endpoint,
      fetchAttempted: false,
      initDataPresent: false,
      responseStatus: null,
      errorCategory: "auth_required",
    });
    logLiveHttpFailure({
      phase: "missing_init_data",
      url,
      method: "GET",
      status: 401,
      error: new Error("Telegram initData is required"),
    });
    throw new ApiError("auth_required", "Telegram initData is required", {
      status: 401,
      retryable: false,
    });
  }

  let authorization: string;
  try {
    authorization = buildAuthHeader(initData);
  } catch (error) {
    logMiniAppAuthDiag(authDiagFromRaw(null));
    throw error instanceof ApiError
      ? error
      : new ApiError("auth_required", "Telegram initData is required", {
          status: 401,
          retryable: false,
        });
  }

  logMiniAppAuthDiag({
    ...authDiagFromRaw(initData),
    authHeaderBuilt:
      authorization.startsWith("tma ") &&
      authorization.slice(4) === initData &&
      !authorization.slice(4).startsWith("tma ") &&
      Boolean(initData),
  });

  const fetchFn = deps.fetchFn ?? fetch;
  recordApiDiag({
    apiHost: new URL(url).host,
    endpoint,
    fetchAttempted: true,
    initDataPresent: true,
    responseStatus: null,
    errorCategory: null,
  });

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
    });
  } catch (error) {
    recordApiDiag({
      endpoint,
      fetchAttempted: true,
      initDataPresent: true,
      errorCategory: "network",
    });
    logLiveHttpFailure({
      phase: "fetch_threw",
      url,
      method: "GET",
      error,
    });
    throw new ApiError("network", "Network request failed", {
      retryable: true,
    });
  }

  recordApiDiag({
    endpoint,
    fetchAttempted: true,
    initDataPresent: true,
    responseStatus: response.status,
    errorCategory: response.ok ? null : String(response.status),
  });

  if (response.status === 401) {
    const bodyText = await response.clone().text().catch(() => "");
    logLiveHttpFailure({
      phase: "http_401",
      url,
      method: "GET",
      status: 401,
      bodyText,
    });
    throw new ApiError("auth_required", "Unauthorized", {
      status: 401,
      retryable: false,
    });
  }
  if (response.status === 503) {
    const bodyText = await response.clone().text().catch(() => "");
    logLiveHttpFailure({
      phase: "http_503",
      url,
      method: "GET",
      status: 503,
      bodyText,
    });
    throw new ApiError("unavailable", "Service unavailable", {
      status: 503,
      retryable: true,
    });
  }
  if (!response.ok) {
    const bodyText = await response.clone().text().catch(() => "");
    logLiveHttpFailure({
      phase: "http_error",
      url,
      method: "GET",
      status: response.status,
      bodyText,
    });
    throw new ApiError(
      response.status === 400 ? "bad_request" : "unknown",
      "Request failed",
      {
        status: response.status,
        retryable: response.status >= 500 || response.status === 404,
      }
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    recordApiDiag({
      errorCategory: "malformed",
      responseStatus: response.status,
    });
    logLiveHttpFailure({
      phase: "json_parse",
      url,
      method: "GET",
      status: response.status,
      error,
    });
    throw new ApiError("malformed", "Invalid JSON response", {
      status: response.status,
      retryable: true,
    });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    (payload as { data: unknown }).data === undefined
  ) {
    recordApiDiag({
      errorCategory: "malformed",
      responseStatus: response.status,
    });
    logLiveHttpFailure({
      phase: "missing_data_envelope",
      url,
      method: "GET",
      status: response.status,
      bodyText: JSON.stringify(payload).slice(0, 500),
    });
    throw new ApiError("malformed", "Missing data envelope", {
      status: response.status,
      retryable: true,
    });
  }

  return (payload as { data: T }).data;
}

/**
 * Authenticated JSON request (PATCH/POST) against ALMAS API.
 */
export async function liveSendJson<T>(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  deps: LiveHttpDeps
): Promise<T> {
  const endpoint = pathOnly(path);
  let url: string;
  try {
    url = joinApiUrl(deps.baseUrl, path);
  } catch {
    recordApiDiag({
      endpoint,
      fetchAttempted: false,
      errorCategory: "unavailable",
    });
    throw new ApiError("unavailable", "API URL is not configured", {
      retryable: false,
    });
  }

  const getInitData = deps.getInitData ?? getRawInitData;
  const retryMs = deps.initDataRetryMs ?? 120;
  const attempts = deps.initDataAttempts ?? (retryMs <= 0 ? 1 : 5);
  const initData = await resolveInitDataForRequest(
    getInitData,
    retryMs,
    attempts
  );

  if (!initData) {
    logMiniAppAuthDiag(authDiagFromRaw(null));
    recordApiDiag({
      endpoint,
      fetchAttempted: false,
      initDataPresent: false,
      errorCategory: "auth_required",
    });
    throw new ApiError("auth_required", "Telegram initData is required", {
      status: 401,
      retryable: false,
    });
  }

  let authorization: string;
  try {
    authorization = buildAuthHeader(initData);
  } catch (error) {
    logMiniAppAuthDiag(authDiagFromRaw(null));
    throw error instanceof ApiError
      ? error
      : new ApiError("auth_required", "Telegram initData is required", {
          status: 401,
          retryable: false,
        });
  }

  const fetchFn = deps.fetchFn ?? fetch;
  recordApiDiag({
    apiHost: new URL(url).host,
    endpoint,
    fetchAttempted: true,
    initDataPresent: true,
    responseStatus: null,
    errorCategory: null,
  });

  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (error) {
    recordApiDiag({
      endpoint,
      fetchAttempted: true,
      errorCategory: "network",
    });
    logLiveHttpFailure({
      phase: "fetch_threw",
      url,
      method,
      error,
    });
    throw new ApiError("network", "Network request failed", {
      retryable: true,
    });
  }

  recordApiDiag({
    endpoint,
    fetchAttempted: true,
    responseStatus: response.status,
    errorCategory: response.ok ? null : String(response.status),
  });

  if (response.status === 401) {
    const bodyText = await response.clone().text().catch(() => "");
    logLiveHttpFailure({
      phase: "http_401",
      url,
      method,
      status: 401,
      bodyText,
    });
    throw new ApiError("auth_required", "Unauthorized", {
      status: 401,
      retryable: false,
    });
  }
  if (!response.ok) {
    const bodyText = await response.clone().text().catch(() => "");
    logLiveHttpFailure({
      phase: "http_error",
      url,
      method,
      status: response.status,
      bodyText,
    });
    throw new ApiError(
      response.status === 400 ? "bad_request" : "unknown",
      "Request failed",
      {
        status: response.status,
        retryable: response.status >= 500 || response.status === 404,
      }
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("malformed", "Invalid JSON response", {
      status: response.status,
      retryable: true,
    });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    (payload as { data: unknown }).data === undefined
  ) {
    throw new ApiError("malformed", "Missing data envelope", {
      status: response.status,
      retryable: true,
    });
  }

  return (payload as { data: T }).data;
}
