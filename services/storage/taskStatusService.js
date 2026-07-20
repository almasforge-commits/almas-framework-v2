import { supabase } from "../../providers/storage/supabase.js";

export async function updateTaskStatus(taskId, status) {
  // Read only the fields we need — never select every column into a log path.
  const { data: task, error: readError } = await supabase
    .from("memories")
    .select("id, content, metadata")
    .eq("id", taskId)
    .single();

  if (readError || !task) {
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

  // Concise metadata only — never log the full returned database row.
  console.log(
    `[task] action=update_status id=${taskId} status=${status} rows=${data?.length ?? 0} ok=${!updateError}`
  );

  if (updateError) {
    console.error(`[task] update_status failed id=${taskId}:`, updateError.message || updateError);
    return null;
  }

  return {
    ...task,
    metadata,
  };
}
