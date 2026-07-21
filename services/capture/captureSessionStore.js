/**
 * Injectable Capture Session store (v1).
 * Primary: in-memory, one active session per actorKey+chatId.
 * Optional: best-effort Supabase persistence + load-by-id for cross-process
 * Mini App API hosts (bot and API are separate Node processes).
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
  const loadByIdFn = options.loadByIdFn || null;

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

      if (session.status === "pending" || session.status === "editing") {
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

    /**
     * Memory first, then optional durable load (Supabase) for cross-process API.
     * @param {string} sessionId
     * @param {string|null} [actorKey]
     * @returns {Promise<object|null>}
     */
    async ensureLoaded(sessionId, actorKey = null) {
      const local = this.getById(sessionId, actorKey);
      if (local) return local;
      if (typeof loadByIdFn !== "function") return null;

      let remote = null;
      try {
        remote = await loadByIdFn(sessionId, actorKey);
      } catch (error) {
        console.error(
          "[capture] loadById failed:",
          error?.message || error
        );
        return null;
      }
      if (!remote || !remote.id) return null;
      if (actorKey && remote.actorKey !== actorKey) return null;

      indexById(remote);
      if (
        (remote.status === "pending" || remote.status === "editing") &&
        isCaptureSessionActive(remote, nowFn())
      ) {
        map.set(
          buildCaptureSessionKey(remote.actorKey, remote.chatId),
          remote
        );
      }
      return this.getById(sessionId, actorKey);
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

/**
 * Map a capture_sessions row into the in-memory session shape.
 * @param {object} row
 * @returns {object|null}
 */
export function mapCaptureSessionRow(row) {
  if (!row || !row.id) return null;
  const createdAt = row.created_at
    ? Date.parse(row.created_at)
    : Number(row.createdAt) || Date.now();
  const expiresAt = row.expires_at
    ? Date.parse(row.expires_at)
    : Number(row.expiresAt) || createdAt;
  const confirmedAt = row.confirmed_at
    ? Date.parse(row.confirmed_at)
    : row.confirmedAt != null
      ? Number(row.confirmedAt)
      : null;

  return {
    id: String(row.id),
    actorKey: String(row.actor_key || row.actorKey || ""),
    chatId: row.chat_id ?? row.chatId ?? null,
    source: row.source || "text",
    originalText: String(row.original_text || row.originalText || ""),
    draft:
      row.draft_json && typeof row.draft_json === "object"
        ? row.draft_json
        : row.draft && typeof row.draft === "object"
          ? row.draft
          : { actions: [] },
    status: String(row.status || "pending"),
    requestKey: row.request_key ?? row.requestKey ?? null,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now(),
    confirmedAt: Number.isFinite(confirmedAt) ? confirmedAt : null,
  };
}

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

/**
 * Load one capture session by id (actor-scoped). Returns null if missing/mismatch.
 * @param {string} sessionId
 * @param {string|null} actorKey
 * @param {object} supabase
 */
export async function loadCaptureSessionFromSupabase(
  sessionId,
  actorKey,
  supabase
) {
  if (!supabase || !sessionId) return null;
  try {
    const { data, error } = await supabase
      .from("capture_sessions")
      .select(
        "id, actor_key, chat_id, source, original_text, draft_json, status, request_key, created_at, confirmed_at, expires_at"
      )
      .eq("id", String(sessionId))
      .maybeSingle();

    if (error || !data) return null;
    const session = mapCaptureSessionRow(data);
    if (!session) return null;
    if (actorKey && session.actorKey !== actorKey) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Default store shared by Telegram bot + API in-process, with durable
 * Supabase persistence when SUPABASE_* is configured (migration 0006).
 */
export function createDefaultCaptureSessionStore(options = {}) {
  const client = options.supabase ?? null;

  return createCaptureSessionStore({
    ...options,
    persistFn: async (session) => {
      const sb =
        client ||
        (await import("../../providers/storage/supabase.js")).supabase;
      return persistCaptureSessionToSupabase(session, sb);
    },
    loadByIdFn: async (sessionId, actorKey) => {
      const sb =
        client ||
        (await import("../../providers/storage/supabase.js")).supabase;
      return loadCaptureSessionFromSupabase(sessionId, actorKey, sb);
    },
  });
}

export const defaultCaptureSessionStore = createDefaultCaptureSessionStore();
