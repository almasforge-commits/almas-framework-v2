import {
  asyncHandler,
  parseLimitOffset,
  sendData,
  HttpError,
} from "../httpErrors.js";

export function createTasksRouter(deps) {
  const router = deps.Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { limit, offset } = parseLimitOffset(req.query);
      const result = await deps.tasksReader.list(req.actor, { limit, offset });
      sendData(res, result.items, result.meta);
    })
  );

  router.patch(
    "/:taskId",
    asyncHandler(async (req, res) => {
      const taskId = String(req.params?.taskId || "").trim();
      if (!taskId) {
        throw new HttpError(400, "missing_id", "Missing task id");
      }
      const completed = req.body?.completed;
      if (typeof completed !== "boolean") {
        throw new HttpError(
          400,
          "invalid_body",
          "Body must include completed:boolean"
        );
      }
      if (typeof deps.tasksReader.patch !== "function") {
        throw new HttpError(501, "not_implemented", "Task update unavailable");
      }
      const updated = await deps.tasksReader.patch(req.actor, taskId, {
        completed,
      });
      if (!updated) {
        throw new HttpError(404, "not_found", "Task not found");
      }
      sendData(res, updated);
    })
  );

  return router;
}
