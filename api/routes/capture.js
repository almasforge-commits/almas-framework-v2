/**
 * Capture Session API — read + Mini App draft edit/confirm (before write).
 */

import { asyncHandler, sendData, HttpError } from "../httpErrors.js";
import {
  patchCaptureSessionActions,
  confirmCaptureSessionById,
  cancelCaptureSessionById,
} from "../../services/capture/captureSessionMutations.js";
import { formatCaptureDraftDetail } from "../../services/capture/capturePreview.js";

export function createCaptureRouter(deps) {
  const router = deps.Router();
  const store = deps.captureStore || null;

  router.get(
    "/:sessionId",
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params?.sessionId ?? "").trim();
      if (!sessionId) {
        throw new HttpError(400, "missing_id", "Missing capture session id");
      }

      const result = await deps.captureReader.getById(req.actor, sessionId);
      if (!result?.item) {
        throw new HttpError(404, "not_found", "Capture session not found");
      }

      sendData(res, result.item);
    })
  );

  router.patch(
    "/:sessionId",
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params?.sessionId ?? "").trim();
      const actorKey = req.actor?.actorKey;
      if (!sessionId) {
        throw new HttpError(400, "missing_id", "Missing capture session id");
      }
      if (!actorKey) {
        throw new HttpError(401, "unauthorized", "Unauthorized");
      }

      const actions = req.body?.actions;
      if (!Array.isArray(actions)) {
        throw new HttpError(400, "invalid_body", "Body must include actions[]");
      }

      const result = await patchCaptureSessionActions(
        sessionId,
        actorKey,
        actions,
        { store: store || undefined }
      );
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : 400;
        throw new HttpError(status, result.reason || "patch_failed", "Cannot update capture session");
      }

      sendData(res, result.detail);
    })
  );

  router.post(
    "/:sessionId/confirm",
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params?.sessionId ?? "").trim();
      if (!sessionId) {
        throw new HttpError(400, "missing_id", "Missing capture session id");
      }

      const result = await confirmCaptureSessionById(sessionId, req.actor, {
        store: store || undefined,
        executorDeps: deps.captureExecutorDeps || {},
      });

      if (!result.ok) {
        if (result.reason === "validation_failed") {
          throw new HttpError(
            400,
            "validation_failed",
            (result.validationErrors || []).join(". ") ||
              "Capture draft validation failed"
          );
        }
        const status =
          result.reason === "not_found"
            ? 404
            : result.reason === "persist_failed"
              ? 503
              : 400;
        throw new HttpError(
          status,
          result.reason || "confirm_failed",
          result.reason === "persist_failed"
            ? "Capture confirm could not persist entities"
            : "Cannot confirm capture session"
        );
      }

      sendData(res, {
        confirmed: true,
        reason: result.reason,
        executedCount: result.executedCount ?? 0,
        execution: result.execution
          ? {
              executedCount: result.execution.executedCount,
              results: result.execution.results,
            }
          : null,
      });
    })
  );

  router.post(
    "/:sessionId/cancel",
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params?.sessionId ?? "").trim();
      const actorKey = req.actor?.actorKey;
      if (!sessionId) {
        throw new HttpError(400, "missing_id", "Missing capture session id");
      }

      const result = await cancelCaptureSessionById(sessionId, actorKey, {
        store: store || undefined,
      });
      if (!result.ok) {
        throw new HttpError(404, "not_found", "Capture session not found");
      }

      sendData(res, { cancelled: true });
    })
  );

  return router;
}

export { formatCaptureDraftDetail };
