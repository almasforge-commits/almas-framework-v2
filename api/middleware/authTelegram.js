import { validateInitData } from "../auth/validateInitData.js";
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
 *   log?: (code: string) => void,
 * }} deps
 */
export function createAuthTelegramMiddleware(deps) {
  const validate = deps.validateInitDataFn ?? validateInitData;

  return function authTelegram(req, _res, next) {
    try {
      // Explicitly ignore forged identity headers / query / body.
      // Identity comes only from validated Authorization initData.
      void req.headers["x-telegram-user-id"];
      void req.headers["x-user-id"];
      void req.query?.userId;
      void req.query?.initData;
      void req.body?.initData;
      void req.body?.initDataUnsafe;

      const header = req.headers.authorization;
      if (typeof header !== "string" || !header.trim()) {
        throw unauthorizedError("missing_header");
      }

      const match = header.match(/^tma\s+(.+)$/i);
      if (!match) {
        throw unauthorizedError("bad_scheme");
      }

      const initDataRaw = match[1].trim();
      const result = validate(initDataRaw, deps.botToken, {
        nowMs: typeof deps.nowMs === "function" ? deps.nowMs() : undefined,
        maxAgeSeconds: deps.maxAgeSeconds,
        clockSkewSeconds: deps.clockSkewSeconds,
      });

      if (!result.ok) {
        throw unauthorizedError(result.code);
      }

      req.actor = result.actor;
      next();
    } catch (error) {
      next(error);
    }
  };
}
