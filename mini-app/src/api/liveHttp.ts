import { ApiError } from "./apiErrors";
import { getRawInitData } from "../telegram/initData";

export type FetchLike = typeof fetch;

export interface LiveHttpDeps {
  baseUrl: string;
  fetchFn?: FetchLike;
  getInitData?: () => string | null;
}

function buildAuthHeader(initData: string): string {
  return `tma ${initData}`;
}

/**
 * Authenticated GET against the ALMAS read-only API.
 * Sends only Authorization: tma <rawInitData>.
 */
export async function liveGetJson<T>(
  path: string,
  deps: LiveHttpDeps
): Promise<T> {
  const baseUrl = deps.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ApiError("unavailable", "API URL is not configured", {
      retryable: false,
    });
  }

  const getInitData = deps.getInitData ?? getRawInitData;
  const initData = getInitData();
  if (!initData) {
    throw new ApiError("auth_required", "Telegram initData is required", {
      status: 401,
      retryable: false,
    });
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildAuthHeader(initData),
      },
    });
  } catch {
    throw new ApiError("network", "Network request failed", {
      retryable: true,
    });
  }

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
      { status: response.status, retryable: response.status >= 500 }
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

/**
 * Authenticated JSON request (PATCH/POST) against ALMAS API.
 */
export async function liveSendJson<T>(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  deps: LiveHttpDeps
): Promise<T> {
  const baseUrl = deps.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ApiError("unavailable", "API URL is not configured", {
      retryable: false,
    });
  }

  const getInitData = deps.getInitData ?? getRawInitData;
  const initData = getInitData();
  if (!initData) {
    throw new ApiError("auth_required", "Telegram initData is required", {
      status: 401,
      retryable: false,
    });
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(initData),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("network", "Network request failed", {
      retryable: true,
    });
  }

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
      { status: response.status, retryable: response.status >= 500 }
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

export { buildAuthHeader };
