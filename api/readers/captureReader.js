/**
 * Capture Session reader for Mini App API — reuses capture store + draft detail.
 */

import { formatCaptureDraftDetail } from "../../services/capture/capturePreview.js";
import { defaultCaptureSessionStore } from "../../services/capture/captureSessionStore.js";

/**
 * @param {object} [deps]
 * @param {object} [deps.store]
 */
export function createCaptureReader(deps = {}) {
  const store = deps.store || defaultCaptureSessionStore;

  return {
    /**
     * @param {object} actor - validated Telegram actor ({ actorKey, ... })
     * @param {string} sessionId
     */
    async getById(actor, sessionId) {
      const actorKey = actor?.actorKey;
      if (!actorKey) {
        return { item: null, reason: "missing_actor" };
      }

      const session =
        typeof store.ensureLoaded === "function"
          ? await store.ensureLoaded(sessionId, actorKey)
          : store.getById(sessionId, actorKey);
      if (!session) {
        return { item: null, reason: "not_found" };
      }

      return {
        item: formatCaptureDraftDetail(session),
      };
    },
  };
}
