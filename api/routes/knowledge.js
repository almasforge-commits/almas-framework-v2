import {
  asyncHandler,
  parseLimitOffset,
  sendData,
} from "../httpErrors.js";

export function createKnowledgeRouter(deps) {
  const router = deps.Router();
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { limit, offset } = parseLimitOffset(req.query);
      const result = await deps.knowledgeReader.list(req.actor, {
        limit,
        offset,
      });
      sendData(res, result.items, result.meta);
    })
  );
  return router;
}
