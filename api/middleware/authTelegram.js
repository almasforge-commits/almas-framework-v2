import {
  AUTH_REASON,
  validateInitData,
} from "../auth/validateInitData.js";
import { unauthorizedError } from "../httpErrors.js";

/**
 * ALMAS API convention (not an official Telegram HTTP requirement):
 *   Authorization: tma <raw Telegram.WebApp.initData>
 *
 * No alternative identity source is accepted (query, body, cookie,
 * initDataUnsafe, or X-Telegram-User-Id / similar headers).
 *
 * @param {{
 *   botToken: string,
 *   nowMs?: () => number,
 *   maxAgeSeconds?: number,
 *   clockSkewSeconds?: number,
 *   validateInitDataFn?: typeof validateInitData,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createAuthTelegramMiddleware(deps) {
  const validate = deps.validateInitDataFn ?? validateInitData;
  const log =
    typeof deps.log === "function"
      ? deps.log
      : (line) => {
          console.error(line);
        };

  return function authTelegram(req, _res, next) {
    const diag = {
      headerPresent: false,
      scheme: "missing",
      initDataLength: 0,
      hashPresent: false,
      authDatePresent: false,
      userPresent: false,
      validation: "failed",
      reason: AUTH_REASON.missing_header,
      ageSeconds: null,
    };

    try {
      // Explicitly ignore forged identity headers / query / body.
      void req.headers["x-telegram-user-id"];
      void req.headers["x-user-id"];
      void req.query?.userId;
      void req.query?.initData;
      void req.body?.initData;
      void req.body?.initDataUnsafe;

      const header = req.headers.authorization;
      if (typeof header !== "string" || !header.trim()) {
        diag.reason = AUTH_REASON.missing_header;
        logAuthDiag(log, diag);
        throw unauthorizedError(AUTH_REASON.missing_header);
      }
      diag.headerPresent = true;

      // Capture raw initData after scheme — do not JSON-parse, decode, or mutate.
      const match = header.match(/^tma(?:\s+(.*))?$/i);
      if (!match) {
        diag.scheme = "other";
        diag.reason = AUTH_REASON.invalid_scheme;
        logAuthDiag(log, diag);
        throw unauthorizedError(AUTH_REASON.invalid_scheme);
      }
      diag.scheme = "tma";

      // Preserve internal characters; only drop surrounding whitespace/CRLF.
      const initDataRaw = String(match[1] ?? "").replace(/^\s+|\s+$/g, "");
      diag.initDataLength = initDataRaw.length;
      if (!initDataRaw) {
        diag.reason = AUTH_REASON.empty_init_data;
        logAuthDiag(log, diag);
        throw unauthorizedError(AUTH_REASON.empty_init_data);
      }

      // Safe field presence peek (names/booleans only — never log values).
      try {
        const peek = new URLSearchParams(initDataRaw);
        diag.hashPresent = Boolean(peek.get("hash"));
        diag.authDatePresent = Boolean(peek.get("auth_date"));
        diag.userPresent = Boolean(peek.get("user"));
      } catch {
        diag.reason = AUTH_REASON.malformed_init_data;
        logAuthDiag(log, diag);
        throw unauthorizedError(AUTH_REASON.malformed_init_data);
      }

      const result = validate(initDataRaw, deps.botToken, {
        nowMs: typeof deps.nowMs === "function" ? deps.nowMs() : undefined,
        maxAgeSeconds: deps.maxAgeSeconds,
        clockSkewSeconds: deps.clockSkewSeconds,
      });

      if (!result.ok) {
        diag.reason = result.code || AUTH_REASON.validator_exception;
        diag.hashPresent = result.meta?.hashPresent ?? diag.hashPresent;
        diag.authDatePresent =
          result.meta?.authDatePresent ?? diag.authDatePresent;
        diag.userPresent = result.meta?.userPresent ?? diag.userPresent;
        if (Number.isFinite(result.meta?.ageSeconds)) {
          diag.ageSeconds = result.meta.ageSeconds;
        }
        logAuthDiag(log, diag);
        throw unauthorizedError(diag.reason);
      }

      diag.validation = "ok";
      diag.reason = "ok";
      if (Number.isFinite(result.meta?.ageSeconds)) {
        diag.ageSeconds = result.meta.ageSeconds;
      }
      logAuthDiag(log, diag);

      req.actor = result.actor;
      next();
    } catch (error) {
      if (error?.status === 401) {
        next(error);
        return;
      }
      diag.reason = AUTH_REASON.validator_exception;
      diag.validation = "failed";
      logAuthDiag(log, diag);
      next(unauthorizedError(AUTH_REASON.validator_exception));
    }
  };
}

/**
 * Safe multi-line auth diagnostics — booleans / lengths / reason codes only.
 * @param {(line: string) => void} log
 * @param {object} diag
 */
export function logAuthDiag(log, diag) {
  const age =
    diag.ageSeconds == null || !Number.isFinite(diag.ageSeconds)
      ? "n/a"
      : String(diag.ageSeconds);
  log(`[auth] headerPresent=${diag.headerPresent ? "true" : "false"}`);
  log(`[auth] scheme=${diag.scheme}`);
  log(`[auth] initDataLength=${Number(diag.initDataLength) || 0}`);
  log(`[auth] hashPresent=${diag.hashPresent ? "true" : "false"}`);
  log(`[auth] authDatePresent=${diag.authDatePresent ? "true" : "false"}`);
  log(`[auth] userPresent=${diag.userPresent ? "true" : "false"}`);
  log(`[auth] validation=${diag.validation}`);
  log(`[auth] reason=${diag.reason}`);
  log(`[auth] ageSeconds=${age}`);
}

/**
 * Parse Authorization: tma <raw> without mutating initData body.
 * @param {string} header
 * @returns {{ ok: true, initData: string } | { ok: false, reason: string, scheme: string }}
 */
export function parseTmaAuthorizationHeader(header) {
  if (typeof header !== "string" || !header.trim()) {
    return { ok: false, reason: AUTH_REASON.missing_header, scheme: "missing" };
  }
  const match = header.match(/^tma(?:\s+(.*))?$/i);
  if (!match) {
    return { ok: false, reason: AUTH_REASON.invalid_scheme, scheme: "other" };
  }
  const initData = String(match[1] ?? "").replace(/^\s+|\s+$/g, "");
  if (!initData) {
    return { ok: false, reason: AUTH_REASON.empty_init_data, scheme: "tma" };
  }
  return { ok: true, initData, scheme: "tma" };
}
