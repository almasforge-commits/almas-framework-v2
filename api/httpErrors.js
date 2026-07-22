export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {string} [logCode] internal reason for server logs only
   */
  constructor(status, code, message, logCode = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.logCode = logCode || code;
  }
}

/** Generic client-facing unauthorized (never reveals which check failed). */
export function unauthorizedError(logCode) {
  return new HttpError(401, "unauthorized", "Unauthorized", logCode);
}

export function sendError(res, error, logger) {
  if (error instanceof HttpError) {
    // Auth middleware already emits detailed [auth] diagnostics.
    // Keep a single compact rejection marker without secrets.
    if (error.status === 401 && typeof logger === "function") {
      if (!String(error.logCode || "").startsWith("[auth]")) {
        logger(`[auth] rejected=${error.logCode}`);
      }
    } else if (error.status >= 500 && typeof logger === "function") {
      logger(`[almas-api] http_error:${error.logCode}`);
    }
    return res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
  }

  if (typeof logger === "function") {
    logger("internal_error");
  }
  return res.status(500).json({
    error: { code: "internal_error", message: "Internal server error" },
  });
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function sendData(res, data, meta = null) {
  // Prevent browser/CDN caching of actor-scoped reads (stale Dashboard after Complete).
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const body = { data };
  if (meta) body.meta = meta;
  return res.json(body);
}

/**
 * @param {unknown} raw
 * @param {{ defaultLimit?: number, maxLimit?: number }} [opts]
 */
export function parseLimitOffset(rawQuery, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? 20;
  const maxLimit = opts.maxLimit ?? 100;

  if (rawQuery.limit != null && rawQuery.limit !== "") {
    const n = Number(rawQuery.limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new HttpError(400, "invalid_limit", "limit must be a positive integer");
    }
  }
  if (rawQuery.offset != null && rawQuery.offset !== "") {
    const n = Number(rawQuery.offset);
    if (!Number.isInteger(n) || n < 0) {
      throw new HttpError(400, "invalid_offset", "offset must be a non-negative integer");
    }
  }

  let limit = rawQuery.limit == null || rawQuery.limit === ""
    ? defaultLimit
    : Number(rawQuery.limit);
  let offset = rawQuery.offset == null || rawQuery.offset === ""
    ? 0
    : Number(rawQuery.offset);

  if (limit > maxLimit) limit = maxLimit;

  return { limit, offset };
}

const PERIODS = new Set(["today", "week", "month"]);

export function parsePeriod(raw, fallback = "month") {
  if (raw == null || raw === "") return fallback;
  const period = String(raw);
  if (!PERIODS.has(period)) {
    throw new HttpError(400, "invalid_period", "period must be today|week|month");
  }
  return period;
}
