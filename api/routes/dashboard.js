import { asyncHandler, sendData } from "../httpErrors.js";

export function createDashboardRouter(deps) {
  const router = deps.Router();
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const payload = await deps.dashboardReader.getHome(req.actor);
      sendData(res, payload);
    })
  );
  return router;
}
