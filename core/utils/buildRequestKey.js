import crypto from "node:crypto";

// A stable per-Telegram-message idempotency key, used so the AI router's
// active-mode execution (services/inbox/actionExecutor.js) can recognize
// "this exact incoming message was already processed" and never execute
// the same action twice for it — e.g. if routeText() were ever invoked
// more than once for the same update (retry, duplicate webhook, etc.).
//
// Telegram's message_id is the primary key (unique per chat): two
// different messages, even with identical text, get different keys, so
// they may execute independently. The hash fallback (a short digest of
// the text) is used only when message_id is unavailable, and is
// therefore weaker — two distinct messages with identical text and no
// message_id would collide. Pure/deterministic — no I/O, no randomness.
//
// @param {{ chatId?: *, messageId?: number|string|null, text?: string }} [input]
// @returns {string}
export function buildRequestKey({ chatId, messageId, text } = {}) {
  const chatPart = chatId ?? "unknown";

  if (messageId != null) {
    return `msg:${chatPart}:${messageId}`;
  }

  const hash = crypto
    .createHash("sha256")
    .update(String(text ?? ""))
    .digest("hex")
    .slice(0, 16);

  return `hash:${chatPart}:${hash}`;
}
