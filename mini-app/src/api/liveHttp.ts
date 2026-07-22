import { ApiError } from "./apiErrors";
import { recordApiDiag } from "./apiDiagnostics";
import { joinApiUrl } from "../config/env";
import { getRawInitData } from "../telegram/initData";
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
  /** Test-only: bound initData poll attempts (default 4). */
  initDataAttempts?: number;
}

/**
 * Exact ALMAS auth header. Must not mutate initData (no decode/JSON/trim of body).
 */
export function buildAuthHeader(initData: string): string {
  // Prefix only — preserve every character of raw Telegram.WebApp.initData.
  return `tma ${initData}`;
}

/** Safe client auth diagnostics — never logs raw initData or Authorization. */
export function logMiniAppAuthDiag(opts: {
  telegramSdkPresent: boolean;
  initDataPresent: boolean;
  initDataLength: number;
  authHeaderBuilt: boolean;
}): void {
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] telegramSdkPresent=${opts.telegramSdkPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] initDataPresent=${opts.initDataPresent ? "true" : "false"}`
  );
  // eslint-disable-next-line no-console
  console.info(`[mini-app-auth] initDataLength=${opts.initDataLength}`);
  // eslint-disable-next-line no-console
  console.info(
    `[mini-app-auth] authHeaderBuilt=${opts.authHeaderBuilt ? "true" : "false"}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read initData after ensuring WebApp.ready().
 * Bounded retries help Telegram Desktop when the bridge fills initData
 * slightly after first paint.
 */
export async function resolveInitDataForRequest(
  getInitData: () => string | null,
  retryMs = 50,
  attempts = 3
): Promise<string | null> {
  const maxAttempts = Math.max(1, attempts);
  for (let i = 0; i < maxAttempts; i += 1) {
    initTelegramWebApp();
    const value = getInitData();
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
  } catch {
    recordApiDiag({
      apiHost: null,
      endpoint,
      fetchAttempted: false,
      initDataPresent: false,
      responseStatus: null,
      errorCategory: "unavailable",
    });
    throw new ApiError("unavailable", "API URL is not configured", {
      retryable: false,
    });
  }

  const getInitData = deps.getInitData ?? getRawInitData;
  const retryMs = deps.initDataRetryMs ?? 100;
  const attempts = deps.initDataAttempts ?? (retryMs <= 0 ? 1 : 4);
  const initData = await resolveInitDataForRequest(
    getInitData,
    retryMs,
    attempts
  );

  if (!initData) {
    logMiniAppAuthDiag({
      telegramSdkPresent: Boolean(getTelegramWebApp()),
      initDataPresent: false,
      initDataLength: 0,
      authHeaderBuilt: false,
    });
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
    throw new ApiError("auth_required", "Telegram initData is required", {
      status: 401,
      retryable: false,
    });
  }

  const authorization = buildAuthHeader(initData);
  logMiniAppAuthDiag({
    telegramSdkPresent: Boolean(getTelegramWebApp()),
    initDataPresent: true,
    initDataLength: initData.length,
    authHeaderBuilt:
      authorization.startsWith("tma ") &&
      authorization.slice(4) === initData &&
      !authorization.slice(4).startsWith("tma "),
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
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    recordApiDiag({
      endpoint,
      fetchAttempted: true,
      initDataPresent: true,
      errorCategory: "network",
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
    throw new ApiError("unauthorized", "Unauthorized", {
      status: 401,
      retryable: false,
    });
  }
  if (response.status === 503) {
    throw new ApiError("unavailable", "Service unavailable", {
      status: 503,
      retryable: true,
    });
  }
  if (!response.ok) {
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
    recordApiDiag({ errorCategory: "malformed", responseStatus: response.status });
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
    recordApiDiag({ errorCategory: "malformed", responseStatus: response.status });
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
  const retryMs = deps.initDataRetryMs ?? 100;
  const attempts = deps.initDataAttempts ?? (retryMs <= 0 ? 1 : 4);
  const initData = await resolveInitDataForRequest(
    getInitData,
    retryMs,
    attempts
  );

  if (!initData) {
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
        Authorization: buildAuthHeader(initData),
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    recordApiDiag({
      endpoint,
      fetchAttempted: true,
      errorCategory: "network",
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
    throw new ApiError("unauthorized", "Unauthorized", {
      status: 401,
      retryable: false,
    });
  }
  if (!response.ok) {
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
