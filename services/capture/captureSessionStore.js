/**
 * Injectable Capture Session store (v1).
 * Primary: in-memory, one active session per actorKey+chatId.
 * Optional: best-effort Supabase persistence when available.
 */

import {
  buildCaptureSessionKey,
  createCaptureSession,
  isCaptureSessionActive,
  CAPTURE_SESSION_TTL_MS,
} from "./captureContracts.js";

/**
 * @param {object} [options]
 */
export function createCaptureSessionStore(options = {}) {
  const map = options.map || new Map();
  /** Session index by id (survives clear for Mini App deep-link reads). */
  const byId = options.byId || new Map();
  const nowFn = options.nowFn || (() => Date.now());
  const ttlMs = options.ttlMs ?? CAPTURE_SESSION_TTL_MS;
  /** Retention of closed/expired sessions for Mini App review. */
  const archiveTtlMs = options.archiveTtlMs ?? Math.max(ttlMs, 30 * 60 * 1000);
  /** @type {Set<string>} */
  const executedIds = options.executedIds || new Set();
  const persistFn = options.persistFn || null;

  async function maybePersist(session) {
    if (typeof persistFn !== "function" || !session) return;
    try {
      await persistFn(session);
    } catch (error) {
      console.error(
        "[capture] persist failed:",
        error?.message || error
      );
    }
  }

  function indexById(session) {
    if (session?.id) byId.set(String(session.id), session);
  }

  function isArchivedReadable(session) {
    if (!session) return false;
    const closedAt = Number(session.confirmedAt || session.expiresAt || 0);
    if (!closedAt) return false;
    return nowFn() - closedAt <= archiveTtlMs;
  }

  return {
    /**
     * @param {object} partial
     * @returns {Promise<object|null>}
     */
    async create(partial = {}) {
      const session = createCaptureSession({
        ...partial,
        nowMs: nowFn(),
        ttlMs: partial.ttlMs ?? ttlMs,
        status: partial.status || "pending",
      });
      if (!session) return null;
      const key = buildCaptureSessionKey(session.actorKey, session.chatId);
      map.set(key, session);
      indexById(session);
      await maybePersist(session);
      return session;
    },

    get(actorKey, chatId) {
      const key = buildCaptureSessionKey(actorKey, chatId);
      const session = map.get(key) || null;
      if (!isCaptureSessionActive(session, nowFn())) {
        if (session && session.status === "pending") {
          session.status = "expired";
          indexById(session);
          map.delete(key);
        } else if (session) {
          map.delete(key);
        }
        return null;
      }
      return session;
    },

    /**
     * Lookup by session id for Mini App / API.
     * Actor-scoped when actorKey is provided.
     * @param {string} sessionId
     * @param {string|null} [actorKey]
     * @returns {object|null}
     */
    getById(sessionId, actorKey = null) {
      const id = String(sessionId || "").trim();
      if (!id) return null;
      const session = byId.get(id) || null;
      if (!session) return null;
      if (actorKey && session.actorKey !== actorKey) return null;

      if (session.status === "pending") {
        if (!isCaptureSessionActive(session, nowFn())) {
          session.status = "expired";
          indexById(session);
          const key = buildCaptureSessionKey(session.actorKey, session.chatId);
          map.delete(key);
          return isArchivedReadable(session) ? session : null;
        }
        return session;
      }

      return isArchivedReadable(session) ? session : null;
    },

    peek(actorKey, chatId) {
      return this.get(actorKey, chatId);
    },

    async update(actorKey, chatId, patch = {}) {
      const current = this.get(actorKey, chatId);
      if (!current) return null;
      const next = {
        ...current,
        ...patch,
        draft: patch.draft ?? current.draft,
        id: current.id,
        actorKey: current.actorKey,
        chatId: current.chatId,
        createdAt: current.createdAt,
        expiresAt:
          patch.refreshTtl === true
            ? nowFn() + ttlMs
            : patch.expiresAt ?? current.expiresAt,
      };
      const key = buildCaptureSessionKey(actorKey, chatId);
      map.set(key, next);
      indexById(next);
      await maybePersist(next);
      return next;
    },

    async clear(actorKey, chatId, status = "cancelled") {
      const key = buildCaptureSessionKey(actorKey, chatId);
      const current = map.get(key);
      if (current) {
        const closed = {
          ...current,
          status,
          confirmedAt:
            status === "confirmed" ? nowFn() : current.confirmedAt,
        };
        map.delete(key);
        indexById(closed);
        await maybePersist(closed);
        return closed;
      }
      return null;
    },

    hasExecuted(sessionId) {
      return executedIds.has(String(sessionId || ""));
    },

    markExecuted(sessionId) {
      if (sessionId) executedIds.add(String(sessionId));
    },

    clearAll() {
      map.clear();
      byId.clear();
      executedIds.clear();
    },

    size() {
      return map.size;
    },
  };
}

export const defaultCaptureSessionStore = createCaptureSessionStore();

/**
 * Best-effort Supabase upsert (optional). Never throws to callers.
 * @param {object} session
 * @param {object} [supabase]
 */
export async function persistCaptureSessionToSupabase(session, supabase) {
  if (!session || !supabase) return false;
  try {
    const { error } = await supabase.from("capture_sessions").upsert(
      {
        id: session.id,
        actor_key: session.actorKey,
        chat_id:
          session.chatId == null || session.chatId === ""
            ? null
            : Number(session.chatId),
        source: session.source,
        original_text: session.originalText,
        draft_json: session.draft || {},
        status: session.status,
        request_key: session.requestKey,
        created_at: new Date(session.createdAt).toISOString(),
        confirmed_at: session.confirmedAt
          ? new Date(session.confirmedAt).toISOString()
          : null,
        expires_at: new Date(session.expiresAt).toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      console.log(
        `[capture] persist ok=false reason=${error.message || "error"}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.log(
      `[capture] persist ok=false reason=${error?.message || "exception"}`
    );
    return false;
  }
}
