import {
  asyncHandler,
  parseLimitOffset,
  parsePeriod,
  sendData,
} from "../httpErrors.js";

export function createFinanceRouter(deps) {
  const router = deps.Router();

  router.get(
    "/summary",
    asyncHandler(async (req, res) => {
      const period = parsePeriod(req.query.period, "month");
      const summary = await deps.financeReader.getSummary(req.actor, period);
      sendData(res, summary);
    })
  );

  router.get(
    "/transactions",
    asyncHandler(async (req, res) => {
      const period = parsePeriod(req.query.period, "month");
      const { limit, offset } = parseLimitOffset(req.query);
      const result = await deps.financeReader.getTransactions(req.actor, {
        period,
        limit,
        offset,
      });
      sendData(res, result.items, result.meta);
    })
  );

  return router;
}
