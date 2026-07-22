/**
 * Dashboard aggregates ONLY already-scoped reader results.
 * Finance totals come from one month bundle (converted to base currency).
 */
import { resolveActivityDomain } from "../mappers/activityDomain.js";
import { looksLikeFinanceAttempt } from "../../services/finance/financeParser.js";

/**
 * Historical inbox rows often still tagged as "idea" for finance voice text.
 * Never show those as Idea in Activity.
 */
export function isFinanceLookingActivityText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (looksLikeFinanceAttempt(value)) return true;
  return (
    /запиши[\s\S]{0,40}(потрат|получил|заработ|доход|расход)/iu.test(value) ||
    /(потратил|потратила|заработал|заработала|получил|получила)\s/iu.test(
      value
    ) ||
    /\d[\d\s]{0,12}\s*(usd|kzt|vnd|доллар|тенге|донг)/iu.test(value)
  );
}

export function createDashboardReader(deps = {}) {
  const financeReader = deps.financeReader;
  const inboxReader = deps.inboxReader;
  const tasksReader = deps.tasksReader;
  const knowledgeReader = deps.knowledgeReader;

  return {
    async getHome(actor) {
      const t0 = Date.now();

      const [financeBundle, inboxResult, tasksResult, knowledgeResult] =
        await Promise.all([
          typeof financeReader.getDashboardBundle === "function"
            ? financeReader.getDashboardBundle(actor)
            : (async () => {
                const overview =
                  typeof financeReader.getOverview === "function"
                    ? await financeReader.getOverview(actor, "month", {
                        limit: 5,
                        offset: 0,
                      })
                    : null;
                if (overview) {
                  return {
                    summary: overview.summary,
                    transactions: overview.items || [],
                  };
                }
                const [summary, tx] = await Promise.all([
                  financeReader.getSummary(actor, "month"),
                  financeReader.getTransactions(actor, {
                    period: "month",
                    limit: 5,
                    offset: 0,
                  }),
                ]);
                return { summary, transactions: tx.items || [] };
              })(),
          inboxReader.list(actor, { limit: 12, offset: 0 }),
          tasksReader.list(actor, { limit: 20, offset: 0 }),
          knowledgeReader.list(actor, { limit: 10, offset: 0 }),
        ]);

      const financeSummary = financeBundle.summary || {};
      const recentTx = Array.isArray(financeBundle.transactions)
        ? financeBundle.transactions
        : [];
      const inbox = inboxResult.items || [];
      const tasks = tasksResult.items || [];
      const knowledge = knowledgeResult.items || [];

      const todayActivity = [];
      const seenActivity = new Set();

      for (const tx of recentTx) {
        const id = `fin-${tx.id}`;
        if (seenActivity.has(id)) continue;
        seenActivity.add(id);
        todayActivity.push({
          id,
          kind: tx.type === "income" ? "income" : "expense",
          title: `${tx.type === "income" ? "Доход" : "Расход"} ${Number(
            tx.amount
          ).toLocaleString("ru-RU")} ${tx.currency}`,
          subtitle: tx.description || tx.category || "",
          time: tx.date || "",
        });
      }

      for (const task of tasks.filter((t) => !t.completed).slice(0, 3)) {
        const id = `task-${task.id}`;
        if (seenActivity.has(id)) continue;
        seenActivity.add(id);
        todayActivity.push({
          id,
          kind: "task",
          title: task.title,
          subtitle: task.dueLabel || "",
          time: "",
        });
      }

      for (const item of inbox.slice(0, 8)) {
        const text = item.originalText || item.normalizedText || "";
        if (isFinanceLookingActivityText(text)) continue;
        const domain = resolveActivityDomain(item.informationKinds, {
          executionSummary: item.executionSummary,
          originalText: text,
        });
        if (domain === "expense" || domain === "income") continue;
        const id = `inbox-${item.id}`;
        if (seenActivity.has(id)) continue;
        seenActivity.add(id);
        todayActivity.push({
          id,
          kind: domain === "memory" ? "idea" : domain,
          title: String(text).slice(0, 80),
          subtitle: "",
          time: item.time || "",
        });
      }

      for (const item of knowledge.slice(0, 2)) {
        const id = `know-${item.id}`;
        if (seenActivity.has(id)) continue;
        seenActivity.add(id);
        todayActivity.push({
          id,
          kind: "knowledge",
          title: item.title,
          subtitle: item.sourceType || "",
          time: item.createdAt || "",
        });
      }

      const recentActions = [];
      for (const tx of recentTx.slice(0, 5)) {
        recentActions.push({
          id: `act-fin-${tx.id}`,
          kind: tx.type === "income" ? "income" : "expense",
          title: `${tx.type === "income" ? "Доход" : "Расход"} ${Number(
            tx.amount
          ).toLocaleString("ru-RU")} ${tx.currency}`,
          subtitle: tx.description || "",
          time: tx.date || "",
        });
      }
      for (const item of inbox) {
        if (recentActions.length >= 8) break;
        const text = item.originalText || "";
        if (isFinanceLookingActivityText(text)) continue;
        const domain = resolveActivityDomain(item.informationKinds, {
          executionSummary: item.executionSummary,
          originalText: text,
        });
        if (domain === "expense" || domain === "income") continue;
        recentActions.push({
          id: `act-${item.id}`,
          kind:
            domain === "task"
              ? "task"
              : domain === "knowledge"
                ? "knowledge"
                : "idea",
          title: String(text || item.status || "").slice(0, 80),
          subtitle: "",
          time: item.time || "",
        });
      }

      const baseCurrency =
        financeSummary.baseCurrency || financeSummary.currency || "VND";
      const expensesToday =
        typeof financeSummary.expenseBase === "number"
          ? financeSummary.expenseBase
          : financeSummary.expensesMonth || 0;
      const incomeToday =
        typeof financeSummary.incomeBase === "number"
          ? financeSummary.incomeBase
          : financeSummary.incomeMonth || 0;
      const balanceToday =
        typeof financeSummary.balanceBase === "number"
          ? financeSummary.balanceBase
          : financeSummary.balance || incomeToday - expensesToday;

      if (typeof deps.log === "function") {
        deps.log(`[dashboard] dashboard_ms=${Date.now() - t0}`);
      }

      return {
        summary: {
          greetingName: actor.firstName || null,
          inboxToday: inbox.filter(
            (item) =>
              !isFinanceLookingActivityText(
                item.originalText || item.normalizedText || ""
              )
          ).length,
          expensesToday,
          expensesTodayCurrency: baseCurrency,
          incomeToday,
          balanceToday,
          baseCurrency,
          fxStatus: financeSummary.fxStatus || "ok",
          ratesUpdatedAt: financeSummary.ratesUpdatedAt || null,
          originalCurrencyTotals: financeSummary.originalCurrencyTotals || [],
          activeTasks: tasks.filter((t) => !t.completed).length,
          newKnowledge: knowledge.length,
          statusLabel: "Live",
        },
        todayActivity: todayActivity.slice(0, 8),
        recentTasks: tasks.filter((t) => !t.completed).slice(0, 5),
        recentKnowledge: knowledge.slice(0, 5),
        recentActions: recentActions.slice(0, 8),
        financeSummary,
      };
    },
  };
}
