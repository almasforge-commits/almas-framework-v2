export function mapTask(row) {
  const status = row?.metadata?.status || row?.status;
  const completed = status === "done" || row?.completed === true;
  const title = String(row?.content || row?.title || "").trim() || "Задача";

  return {
    id: String(row.id ?? ""),
    title,
    group: completed ? "done" : "today",
    completed,
    dueLabel: completed ? "Выполнено" : "Сегодня",
  };
}
