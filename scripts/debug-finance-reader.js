#!/usr/bin/env node
/**
 * Safe Finance reader diagnostic.
 *
 * Usage:
 *   node scripts/debug-finance-reader.js --user-id 123 --period month
 *
 * Never prints secrets or full row payloads by default.
 */

import "dotenv/config";
import {
  getFinanceSupabaseStatus,
  listFinanceTransactionsForUser,
  FINANCE_ERROR,
} from "../services/finance/financeStore.js";
import { createFinanceReader } from "../api/readers/financeReader.js";

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const userId = String(argValue("--user-id", process.env.DEBUG_USER_ID || "")).trim();
const period = String(argValue("--period", "month"));

const status = getFinanceSupabaseStatus();
console.log(`[finance-debug] urlPresent=${status.urlPresent ? "true" : "false"}`);
console.log(`[finance-debug] keyPresent=${status.keyPresent ? "true" : "false"}`);
console.log(`[finance-debug] clientCreated=${status.clientCreated ? "true" : "false"}`);
console.log(`[finance-debug] period=${period}`);
console.log(`[finance-debug] actorUserIdPresent=${userId ? "true" : "false"}`);

if (!userId) {
  console.error("[finance-debug] errorCode=invalid_actor");
  process.exit(1);
}

const logs = [];
const reader = createFinanceReader({
  log: (line) => logs.push(String(line)),
});

try {
  const rows = await listFinanceTransactionsForUser(userId, { limit: 50 });
  console.log(`[finance-debug] queryOk=true`);
  console.log(`[finance-debug] rowCount=${rows.length}`);
} catch (error) {
  console.log(`[finance-debug] queryOk=false`);
  console.log(`[finance-debug] errorCode=${error.code || FINANCE_ERROR.unexpected_error}`);
  console.log(
    `[finance-debug] errorMessage=${String(error.details || error.message || "").slice(0, 160)}`
  );
  process.exit(2);
}

try {
  const summary = await reader.getSummary(
    { userId, telegramUserId: Number(userId) || 0 },
    period
  );
  const tx = await reader.getTransactions(
    { userId, telegramUserId: Number(userId) || 0 },
    { period, limit: 20, offset: 0 }
  );
  console.log(`[finance-debug] mappedSummaryOk=true`);
  console.log(`[finance-debug] mappedItemCount=${tx.items.length}`);
  console.log(
    `[finance-debug] summaryTotals=balance:${summary.balance};income:${summary.incomeMonth};expense:${summary.expensesMonth};currency:${summary.currency}`
  );
  process.exit(0);
} catch (error) {
  console.log(`[finance-debug] mappedOk=false`);
  console.log(`[finance-debug] errorCode=${error.logCode || error.code || FINANCE_ERROR.unexpected_error}`);
  process.exit(3);
}
