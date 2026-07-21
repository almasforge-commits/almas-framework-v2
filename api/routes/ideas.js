import { asyncHandler, parseLimitOffset, sendData } from "../httpErrors.js";

export function createIdeasRouter(deps) {
  const router = deps.Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { limit, offset } = parseLimitOffset(req.query);
      const category =
        typeof req.query?.category === "string" && req.query.category.trim()
          ? req.query.category.trim()
          : null;
      const q =
        typeof req.query?.q === "string" && req.query.q.trim()
          ? req.query.q.trim()
          : null;

      const result = q
        ? await deps.ideasReader.search(req.actor, {
            q,
            category,
            limit,
          })
        : await deps.ideasReader.list(req.actor, {
            limit,
            offset,
            category,
            q,
          });

      sendData(res, result.items, result.meta);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = String(req.params?.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "missing_id" });
        return;
      }
      const result = await deps.ideasReader.getById(req.actor, id);
      if (!result?.item) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      sendData(res, result.item);
    })
  );

  return router;
}
