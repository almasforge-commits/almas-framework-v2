import crypto from "node:crypto";

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/** Allowed safe auth reason codes (never include secrets). */
export const AUTH_REASON = Object.freeze({
  missing_header: "missing_header",
  invalid_scheme: "invalid_scheme",
  empty_init_data: "empty_init_data",
  malformed_init_data: "malformed_init_data",
  missing_hash: "missing_hash",
  missing_auth_date: "missing_auth_date",
  expired_auth_date: "expired_auth_date",
  signature_mismatch: "signature_mismatch",
  missing_user: "missing_user",
  invalid_user_json: "invalid_user_json",
  validator_exception: "validator_exception",
});

/**
 * Constant-time hex/string compare that never throws on length mismatch.
 * @param {string} a
 * @param {string} b
 */
export function safeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) {
    // Still perform a dummy compare to keep work roughly similar.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Trim Railway/UI paste artifacts without altering token body.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeBotToken(raw) {
  let token = String(raw ?? "").trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

/**
 * Non-reversible short fingerprint for ops cross-checks (never send to browser).
 * @param {string} botToken
 * @returns {string}
 */
export function botTokenFingerprint(botToken) {
  const token = normalizeBotToken(botToken);
  if (!token) return "missing";
  return crypto.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 8);
}

/**
 * Official Telegram Mini App initData validation (bot-token HMAC).
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 *
 * Prose: secret key = HMAC-SHA-256 of bot token with key "WebAppData".
 * Telegram pseudo-code uses HMAC_SHA256(data, key) argument order.
 * Node: createHmac(algo, key).update(data)
 *
 * Correct:
 *   secret = HMAC(key="WebAppData", message=BOT_TOKEN)
 *   hash   = hex(HMAC(key=secret, message=data_check_string))
 *
 * @param {string} initDataRaw raw Telegram.WebApp.initData
 * @param {string} botToken
 * @param {{ nowMs?: number, maxAgeSeconds?: number, clockSkewSeconds?: number }} [options]
 * @returns {{
 *   ok: true,
 *   actor: object,
 *   meta: { authDate: number, ageSeconds: number }
 * } | {
 *   ok: false,
 *   code: string,
 *   meta?: { authDate?: number|null, ageSeconds?: number|null, hashPresent?: boolean, authDatePresent?: boolean, userPresent?: boolean }
 * }}
 */
export function validateInitData(initDataRaw, botToken, options = {}) {
  try {
    return validateInitDataUnsafe(initDataRaw, botToken, options);
  } catch {
    return {
      ok: false,
      code: AUTH_REASON.validator_exception,
      meta: {},
    };
  }
}

function validateInitDataUnsafe(initDataRaw, botToken, options = {}) {
  if (typeof initDataRaw !== "string" || !initDataRaw.trim()) {
    return {
      ok: false,
      code: AUTH_REASON.empty_init_data,
      meta: { hashPresent: false, authDatePresent: false, userPresent: false },
    };
  }

  const normalizedToken = normalizeBotToken(botToken);
  if (!normalizedToken) {
    return {
      ok: false,
      code: AUTH_REASON.validator_exception,
      meta: {},
    };
  }

  let params;
  try {
    params = new URLSearchParams(initDataRaw);
  } catch {
    return {
      ok: false,
      code: AUTH_REASON.malformed_init_data,
      meta: {},
    };
  }

  // Reject empty parse (e.g. completely unusable payload).
  if (![...params.keys()].length) {
    return {
      ok: false,
      code: AUTH_REASON.malformed_init_data,
      meta: {},
    };
  }

  const hashRaw = params.get("hash");
  const authDateRaw = params.get("auth_date");
  const userRaw = params.get("user");
  const hashPresent = Boolean(hashRaw);
  const authDatePresent = authDateRaw != null && authDateRaw !== "";
  const userPresent = userRaw != null && userRaw !== "";

  if (!hashPresent) {
    return {
      ok: false,
      code: AUTH_REASON.missing_hash,
      meta: { hashPresent, authDatePresent, userPresent },
    };
  }
  if (!authDatePresent) {
    return {
      ok: false,
      code: AUTH_REASON.missing_auth_date,
      meta: { hashPresent, authDatePresent, userPresent },
    };
  }
  if (!userPresent) {
    return {
      ok: false,
      code: AUTH_REASON.missing_user,
      meta: { hashPresent, authDatePresent, userPresent },
    };
  }

  // Exclude ONLY hash from the data-check-string (official bot algorithm).
  // Keep `signature` if present — third-party Ed25519 field is still part of HMAC input.
  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  // secretKey = HMAC_SHA256(key="WebAppData", message=BOT_TOKEN)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(normalizedToken, "utf8")
    .digest();

  // calculatedHash = hex(HMAC_SHA256(key=secretKey, message=dataCheckString))
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString, "utf8")
    .digest("hex");

  const receivedHash = String(hashRaw).toLowerCase();
  if (!safeEqualStrings(calculatedHash, receivedHash)) {
    return {
      ok: false,
      code: AUTH_REASON.signature_mismatch,
      meta: { hashPresent, authDatePresent, userPresent },
    };
  }

  // auth_date / user JSON only after signature validation.
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || !Number.isInteger(authDate) || authDate <= 0) {
    return {
      ok: false,
      code: AUTH_REASON.malformed_init_data,
      meta: { hashPresent, authDatePresent, userPresent, authDate: null },
    };
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxAgeSeconds = Number.isFinite(options.maxAgeSeconds)
    ? options.maxAgeSeconds
    : DEFAULT_MAX_AGE_SECONDS;
  const clockSkewSeconds = Number.isFinite(options.clockSkewSeconds)
    ? options.clockSkewSeconds
    : DEFAULT_CLOCK_SKEW_SECONDS;

  const nowSec = Math.floor(nowMs / 1000);
  const ageSeconds = nowSec - authDate;
  if (ageSeconds > maxAgeSeconds) {
    return {
      ok: false,
      code: AUTH_REASON.expired_auth_date,
      meta: { hashPresent, authDatePresent, userPresent, authDate, ageSeconds },
    };
  }
  if (authDate > nowSec + clockSkewSeconds) {
    return {
      ok: false,
      code: AUTH_REASON.expired_auth_date,
      meta: { hashPresent, authDatePresent, userPresent, authDate, ageSeconds },
    };
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return {
      ok: false,
      code: AUTH_REASON.invalid_user_json,
      meta: { hashPresent, authDatePresent, userPresent, authDate, ageSeconds },
    };
  }

  const telegramUserId = Number(user?.id);
  if (
    !Number.isFinite(telegramUserId) ||
    !Number.isInteger(telegramUserId) ||
    telegramUserId <= 0
  ) {
    return {
      ok: false,
      code: AUTH_REASON.missing_user,
      meta: { hashPresent, authDatePresent, userPresent, authDate, ageSeconds },
    };
  }

  return {
    ok: true,
    actor: {
      telegramUserId,
      userId: String(telegramUserId),
      actorKey: `telegram:${telegramUserId}`,
      username: typeof user.username === "string" ? user.username : null,
      firstName: typeof user.first_name === "string" ? user.first_name : null,
      lastName: typeof user.last_name === "string" ? user.last_name : null,
      authDate,
    },
    meta: { authDate, ageSeconds },
  };
}

/**
 * Incorrect reversed HMAC (key=BOT_TOKEN, message="WebAppData").
 * Used only in regression tests — must NOT validate real Telegram initData.
 * @param {string} initDataRaw
 * @param {string} botToken
 */
export function validateInitDataWithReversedHmac(initDataRaw, botToken) {
  const params = new URLSearchParams(initDataRaw);
  const hash = String(params.get("hash") || "").toLowerCase();
  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const token = normalizeBotToken(botToken);
  const secretKey = crypto
    .createHmac("sha256", token)
    .update("WebAppData", "utf8")
    .digest();
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString, "utf8")
    .digest("hex");
  return safeEqualStrings(calculatedHash, hash);
}

/**
 * Build a signed initData string for tests (same bot-token HMAC algorithm).
 * @param {Record<string, string>} fields
 * @param {string} botToken
 */
export function signInitDataForTests(fields, botToken) {
  const token = normalizeBotToken(botToken);
  const pairs = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(token, "utf8")
    .digest();
  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString, "utf8")
    .digest("hex");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (key === "hash") continue;
    params.set(key, value);
  }
  params.set("hash", hash);
  return params.toString();
}
