/**
 * Capture Session contracts — pure, no I/O.
 * One session = one incoming user message pending batch confirmation.
 */

import { randomUUID } from "node:crypto";

export const CAPTURE_SESSION_STATUSES = Object.freeze([
  "pending",
  "editing",
  "confirmed",
  "cancelled",
  "expired",
  "failed",
]);

export const CAPTURE_ACTION_TYPES = Object.freeze([
  "finance_expense",
  "finance_income",
  "task_create",
  "idea_create",
  "memory_save",
  "preference",
  "reminder",
  "knowledge_candidate",
]);

/** Default TTL: 15 minutes. */
export const CAPTURE_SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * @param {string} actorKey
 * @param {string|number|null} chatId
 * @returns {string}
 */
export function buildCaptureSessionKey(actorKey, chatId) {
  const actor = String(actorKey ?? "").trim();
  const chat = chatId == null ? "" : String(chatId).trim();
  return `${actor}::${chat}`;
}

/**
 * @param {object} [input]
 * @returns {object|null}
 */
export function createCaptureAction(input = {}) {
  const type = String(input.type ?? "").trim();
  if (!CAPTURE_ACTION_TYPES.includes(type)) return null;

  const content = String(input.content ?? "").trim();
  const confidence = Number(input.confidence);
  return {
    id: input.id != null ? String(input.id) : randomUUID(),
    type,
    content,
    confidence:
      Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
        ? confidence
        : 0.7,
    payload:
      input.payload && typeof input.payload === "object"
        ? { ...input.payload }
        : {},
    metadata:
      input.metadata && typeof input.metadata === "object"
        ? { ...input.metadata }
        : {},
    relations: Array.isArray(input.relations) ? input.relations.slice() : [],
  };
}

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createCaptureDraft(input = {}) {
  const actions = Array.isArray(input.actions)
    ? input.actions.map((a) => createCaptureAction(a)).filter(Boolean)
    : [];

  return {
    actions,
    language: input.language != null ? String(input.language) : "unknown",
    sourceTier: input.sourceTier != null ? String(input.sourceTier) : "deterministic",
    truncated: Boolean(input.truncated),
    warnings: Array.isArray(input.warnings) ? input.warnings.slice() : [],
  };
}

/**
 * @param {object} [input]
 * @returns {object|null}
 */
export function createCaptureSession(input = {}) {
  const actorKey = String(input.actorKey ?? "").trim();
  if (!actorKey) return null;

  const now = Number(input.nowMs) || Date.now();
  const rawTtl = Number(input.ttlMs);
  const ttl =
    Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : CAPTURE_SESSION_TTL_MS;
  const status = CAPTURE_SESSION_STATUSES.includes(input.status)
    ? input.status
    : "pending";
  const source = String(input.source ?? "text").trim() || "text";

  return {
    id: input.id != null ? String(input.id) : randomUUID(),
    actorKey,
    chatId: input.chatId == null ? null : input.chatId,
    source,
    originalText: String(input.originalText ?? ""),
    draft: createCaptureDraft(input.draft),
    status,
    requestKey: input.requestKey != null ? String(input.requestKey) : null,
    createdAt: now,
    confirmedAt: input.confirmedAt ?? null,
    expiresAt: Number(input.expiresAt) || now + ttl,
    executionSummary: input.executionSummary ?? null,
  };
}

/**
 * @param {object|null} session
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isCaptureSessionActive(session, nowMs = Date.now()) {
  if (!session || typeof session !== "object") return false;
  if (session.status !== "pending" && session.status !== "editing") return false;
  return Number(session.expiresAt) > Number(nowMs);
}

/**
 * Confirm / cancel / edit button payloads and text labels.
 */
export const CAPTURE_CALLBACK = Object.freeze({
  confirm: "capture:confirm",
  edit: "capture:edit",
  cancel: "capture:cancel",
});

export const CAPTURE_TEXT_COMMANDS = Object.freeze({
  confirm: ["✅ сохранить всё", "сохранить всё", "подтвердить", "да, сохрани"],
  edit: ["✏️ исправить", "исправить", "редактировать"],
  cancel: ["❌ отмена", "отмена", "отменить", "не надо", "cancel"],
});

/**
 * @param {string} text
 * @returns {"confirm"|"edit"|"cancel"|null}
 */
export function parseCaptureControlText(text) {
  const n = String(text ?? "")
    .toLowerCase()
    .replace(/[.!…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  if (CAPTURE_TEXT_COMMANDS.confirm.includes(n)) return "confirm";
  if (CAPTURE_TEXT_COMMANDS.edit.includes(n)) return "edit";
  if (CAPTURE_TEXT_COMMANDS.cancel.includes(n)) return "cancel";
  return null;
}
