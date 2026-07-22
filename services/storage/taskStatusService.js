import { supabase } from "../../providers/storage/supabase.js";

/**
 * Update task status with optional actor scope (metadata.userId).
 * @param {string} taskId
 * @param {string} status
 * @param {{ userId?: string|null }} [opts]
 */
export async function updateTaskStatus(taskId, status, opts = {}) {
  const { data: task, error: readError } = await supabase
    .from("memories")
    .select("id, content, metadata")
    .eq("id", taskId)
    .single();

  if (readError || !task) {
    return null;
  }

  const owner =
    task.metadata?.userId != null
      ? String(task.metadata.userId)
      : task.metadata?.telegramUserId != null
        ? String(task.metadata.telegramUserId)
        : null;
  if (opts.userId && owner && owner !== String(opts.userId)) {
    return null;
  }

  const metadata = {
    ...task.metadata,
    status,
  };

  const { data, error: updateError } = await supabase
    .from("memories")
    .update({ metadata })
    .eq("id", taskId)
    .select("id");

  console.log(
    `[task] action=update_status id=${taskId} status=${status} rows=${data?.length ?? 0} ok=${!updateError}`
  );

  if (updateError) {
    console.error(
      `[task] update_status failed id=${taskId}:`,
      updateError.message || updateError
    );
    return null;
  }

  return {
    ...task,
    metadata,
  };
}
