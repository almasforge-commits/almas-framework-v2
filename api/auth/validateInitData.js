import crypto from "node:crypto";

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

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
 * Official Telegram Mini App initData validation (bot-token HMAC).
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 *
 * Does NOT use third-party Ed25519 signature flow.
 *
 * @param {string} initDataRaw raw Telegram.WebApp.initData
 * @param {string} botToken
 * @param {{ nowMs?: number, maxAgeSeconds?: number, clockSkewSeconds?: number }} [options]
 * @returns {{ ok: true, actor: object } | { ok: false, code: string }}
 */
export function validateInitData(initDataRaw, botToken, options = {}) {
  if (typeof initDataRaw !== "string" || !initDataRaw.trim()) {
    return { ok: false, code: "missing_init_data" };
  }
  if (typeof botToken !== "string" || !botToken.trim()) {
    return { ok: false, code: "missing_bot_token" };
  }

  let params;
  try {
    params = new URLSearchParams(initDataRaw);
  } catch {
    return { ok: false, code: "invalid_init_data" };
  }

  // Reject unsafe/malformed percent-encoding leftovers that parse oddly:
  // URLSearchParams is lenient; empty key-only garbage still fails required fields.
  const hash = params.get("hash");
  const authDateRaw = params.get("auth_date");
  const userRaw = params.get("user");

  if (!hash) return { ok: false, code: "missing_hash" };
  if (authDateRaw == null || authDateRaw === "") {
    return { ok: false, code: "missing_auth_date" };
  }
  if (userRaw == null || userRaw === "") {
    return { ok: false, code: "missing_user" };
  }

  // Exclude ONLY hash from the data-check-string (official algorithm).
  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  // secretKey = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // calculatedHash = HMAC_SHA256(key=secretKey, data=dataCheckString) hex
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualStrings(calculatedHash, hash)) {
    return { ok: false, code: "invalid_signature" };
  }

  // auth_date / user JSON only after signature validation.
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || !Number.isInteger(authDate) || authDate <= 0) {
    return { ok: false, code: "invalid_auth_date" };
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
    return { ok: false, code: "expired_init_data" };
  }
  if (authDate > nowSec + clockSkewSeconds) {
    return { ok: false, code: "future_auth_date" };
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, code: "invalid_user" };
  }

  const telegramUserId = Number(user?.id);
  if (
    !Number.isFinite(telegramUserId) ||
    !Number.isInteger(telegramUserId) ||
    telegramUserId <= 0
  ) {
    return { ok: false, code: "missing_user_id" };
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
  };
}

/**
 * Build a signed initData string for tests (same bot-token HMAC algorithm).
 * @param {Record<string, string>} fields
 * @param {string} botToken
 */
export function signInitDataForTests(fields, botToken) {
  const pairs = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (key === "hash") continue;
    params.set(key, value);
  }
  params.set("hash", hash);
  return params.toString();
}
