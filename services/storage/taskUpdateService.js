import { getActiveTasks } from "./taskService.js";
import { updateTaskStatus } from "./taskStatusService.js";

export async function completeTask(index) {
  const tasks = await getActiveTasks();

  if (index < 1 || index > tasks.length) {
    return null;
  }

  const task = tasks[index - 1];

  return await updateTaskStatus(task.id, "done");
}