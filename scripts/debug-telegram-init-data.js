#!/usr/bin/env node
/**
 * Local Telegram initData validator (developer tool).
 *
 * Usage:
 *   TELEGRAM_INIT_DATA='...' node scripts/debug-telegram-init-data.js
 *
 * WARNING: raw initData is sensitive. Do not paste it into chat, tickets,
 * screenshots, or git commits. Prefer setting it only in your local shell.
 *
 * Output is safe: field names, lengths, age, reason codes, and user id
 * only after successful validation. Never prints raw initData / hash / token.
 */

import "dotenv/config";
import {
  AUTH_REASON,
  botTokenFingerprint,
  normalizeBotToken,
  validateInitData,
} from "../api/auth/validateInitData.js";

const initData = process.env.TELEGRAM_INIT_DATA;
const botToken = normalizeBotToken(process.env.BOT_TOKEN);

if (!botToken) {
  console.error("[debug-init-data] error=missing_bot_token");
  process.exit(1);
}

if (typeof initData !== "string" || !initData.trim()) {
  console.error("[debug-init-data] error=missing_TELEGRAM_INIT_DATA");
  console.error(
    "[debug-init-data] hint=TELEGRAM_INIT_DATA='...' node scripts/debug-telegram-init-data.js"
  );
  process.exit(1);
}

let fieldNames = [];
try {
  fieldNames = [...new URLSearchParams(initData).keys()].sort();
} catch {
  fieldNames = [];
}

console.log(`[debug-init-data] botTokenFingerprint=${botTokenFingerprint(botToken)}`);
console.log(`[debug-init-data] initDataLength=${initData.length}`);
console.log(`[debug-init-data] fieldNames=${fieldNames.join(",") || "(none)"}`);
console.log(
  `[debug-init-data] hashPresent=${fieldNames.includes("hash") ? "true" : "false"}`
);
console.log(
  `[debug-init-data] authDatePresent=${fieldNames.includes("auth_date") ? "true" : "false"}`
);
console.log(
  `[debug-init-data] userPresent=${fieldNames.includes("user") ? "true" : "false"}`
);

const result = validateInitData(initData, botToken);

if (!result.ok) {
  console.log(`[debug-init-data] validation=failed`);
  console.log(`[debug-init-data] reason=${result.code || AUTH_REASON.validator_exception}`);
  if (Number.isFinite(result.meta?.ageSeconds)) {
    console.log(`[debug-init-data] ageSeconds=${result.meta.ageSeconds}`);
  }
  process.exit(2);
}

console.log(`[debug-init-data] validation=ok`);
console.log(`[debug-init-data] reason=ok`);
console.log(`[debug-init-data] ageSeconds=${result.meta.ageSeconds}`);
console.log(`[debug-init-data] telegramUserId=${result.actor.telegramUserId}`);
console.log(`[debug-init-data] actorKey=${result.actor.actorKey}`);
process.exit(0);
