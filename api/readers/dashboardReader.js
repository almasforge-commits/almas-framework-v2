/**
 * Dashboard aggregates ONLY already-scoped reader results.
 * Never calls unscoped domain services directly.
 */
import {
  activityDomainLabel,
  resolveActivityDomain,
} from "../mappers/activityDomain.js";

export function createDashboardReader(deps = {}) {
  const financeReader = deps.financeReader;
  const inboxReader = deps.inboxReader;
  const tasksReader = deps.tasksReader;
  const knowledgeReader = deps.knowledgeReader;

  return {
    async getHome(actor) {
      const [financeSummary, inboxResult, tasksResult, knowledgeResult] =
        await Promise.all([
          financeReader.getSummary(actor, "month"),
          inboxReader.list(actor, { limit: 20, offset: 0 }),
          tasksReader.list(actor, { limit: 20, offset: 0 }),
          knowledgeReader.list(actor, { limit: 10, offset: 0 }),
        ]);

      const inbox = inboxResult.items;
      const tasks = tasksResult.items;
      const knowledge = knowledgeResult.items;

      const todayIso = new Date().toISOString().slice(0, 10);
      const expensesTodayPayload = await financeReader.getSummary(actor, "today");
      const txToday = await financeReader.getTransactions(actor, {
        period: "today",
        limit: 5,
        offset: 0,
      });

      const todayActivity = [];
      for (const tx of txToday.items) {
        todayActivity.push({
          id: `fin-${tx.id}`,
          kind: tx.type === "income" ? "income" : "expense",
          title: `${tx.type === "income" ? "Доход" : "Расход"} ${Number(
            tx.amount
          ).toLocaleString("ru-RU")} ${tx.currency}`,
          subtitle: tx.category || tx.description || "Финансы",
          time: tx.date === todayIso ? "" : tx.date,
        });
      }
      for (const task of tasks.filter((t) => !t.completed).slice(0, 2)) {
        todayActivity.push({
          id: `task-${task.id}`,
          kind: "task",
          title: task.title,
          subtitle: task.dueLabel,
          time: "",
        });
      }
      for (const item of inbox.slice(0, 4)) {
        const domain = resolveActivityDomain(item.informationKinds, {
          executionSummary: item.executionSummary,
          originalText: item.originalText,
        });
        // Skip inbox finance rows when we already have transaction cards.
        if (domain === "expense" || domain === "income") continue;
        todayActivity.push({
          id: `inbox-${item.id}`,
          kind: domain === "memory" ? "idea" : domain,
          title: String(item.originalText || "").slice(0, 80),
          subtitle: activityDomainLabel(domain),
          time: item.time,
        });
      }
      for (const item of knowledge.slice(0, 2)) {
        todayActivity.push({
          id: `know-${item.id}`,
          kind: "knowledge",
          title: item.title,
          subtitle: item.sourceType,
          time: item.createdAt,
        });
      }

      const recentActions = inbox.slice(0, 8).map((item) => {
        const domain = resolveActivityDomain(item.informationKinds, {
          executionSummary: item.executionSummary,
          originalText: item.originalText,
        });
        const kind =
          domain === "income"
            ? "income"
            : domain === "expense"
              ? "expense"
              : domain === "task"
                ? "task"
                : domain === "knowledge"
                  ? "knowledge"
                  : "idea";
        return {
          id: `act-${item.id}`,
          kind,
          title: item.originalText.slice(0, 80) || item.status,
          subtitle: activityDomainLabel(domain),
          time: item.time,
        };
      });

      const baseCurrency =
        expensesTodayPayload.baseCurrency ||
        expensesTodayPayload.currency ||
        "VND";
      const expensesToday =
        typeof expensesTodayPayload.expenseBase === "number"
          ? expensesTodayPayload.expenseBase
          : expensesTodayPayload.expensesMonth || 0;

      return {
        summary: {
          greetingName: actor.firstName || null,
          inboxToday: inbox.length,
          expensesToday,
          expensesTodayCurrency: baseCurrency,
          incomeToday:
            typeof expensesTodayPayload.incomeBase === "number"
              ? expensesTodayPayload.incomeBase
              : expensesTodayPayload.incomeMonth || 0,
          balanceToday:
            typeof expensesTodayPayload.balanceBase === "number"
              ? expensesTodayPayload.balanceBase
              : expensesTodayPayload.balance || 0,
          baseCurrency,
          fxStatus: expensesTodayPayload.fxStatus || "ok",
          ratesUpdatedAt: expensesTodayPayload.ratesUpdatedAt || null,
          activeTasks: tasks.filter((t) => !t.completed).length,
          newKnowledge: knowledge.length,
          statusLabel: "Live",
        },
        todayActivity: todayActivity.slice(0, 8),
        recentTasks: tasks.slice(0, 5),
        recentKnowledge: knowledge.slice(0, 5),
        recentActions,
        financeSummary,
      };
    },
  };
}
