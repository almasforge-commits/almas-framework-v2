/**
 * Dashboard aggregates ONLY already-scoped reader results.
 * Never calls unscoped domain services directly.
 */
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
        limit: 3,
        offset: 0,
      });

      const todayActivity = [];
      for (const tx of txToday.items) {
        todayActivity.push({
          id: `exp-${tx.id}`,
          kind: "expense",
          title: `${tx.type === "income" ? "Доход" : "Расход"} ${tx.amount} ${tx.currency}`,
          subtitle: tx.category || tx.description || "",
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
      for (const item of inbox.slice(0, 2)) {
        if (item.informationKinds.includes("idea")) {
          todayActivity.push({
            id: `idea-${item.id}`,
            kind: "idea",
            title: item.originalText.slice(0, 80),
            subtitle: "Идея",
            time: item.time,
          });
        }
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

      const recentActions = inbox.slice(0, 5).map((item) => ({
        id: `act-${item.id}`,
        kind: item.informationKinds.includes("finance")
          ? "expense"
          : item.informationKinds.includes("task")
            ? "task"
            : item.informationKinds.includes("knowledge")
              ? "knowledge"
              : "idea",
        title: item.originalText.slice(0, 80) || item.status,
        subtitle: item.status,
        time: item.time,
      }));

      return {
        summary: {
          greetingName: actor.firstName || null,
          inboxToday: inbox.length,
          expensesToday: expensesTodayPayload.expensesMonth || 0,
          expensesTodayCurrency: expensesTodayPayload.currency || "VND",
          activeTasks: tasks.filter((t) => !t.completed).length,
          newKnowledge: knowledge.length,
          statusLabel: "Live",
        },
        todayActivity: todayActivity.slice(0, 8),
        recentTasks: tasks.slice(0, 5),
        recentKnowledge: knowledge.slice(0, 5),
        recentActions,
      };
    },
  };
}
