#!/usr/bin/env node
/**
 * Safe local BOT_TOKEN fingerprint (SHA-256 hex prefix).
 *
 * Usage (from telegram-bot/):
 *   node scripts/print-bot-token-fingerprint.js
 *
 * Compares with Railway startup log:
 *   [auth] botTokenFingerprint=xxxxxxxx
 *
 * Never prints the token.
 */

import "dotenv/config";
import {
  botTokenFingerprint,
  normalizeBotToken,
} from "../api/auth/validateInitData.js";

const token = normalizeBotToken(process.env.BOT_TOKEN);
if (!token) {
  console.error("[auth] botTokenFingerprint=missing");
  process.exit(1);
}

console.log(`[auth] botTokenFingerprint=${botTokenFingerprint(token)}`);
console.log(`[auth] botTokenLength=${token.length}`);
console.log(`[auth] botTokenLooksLikeTelegram=${/^\d+:/.test(token) ? "true" : "false"}`);
