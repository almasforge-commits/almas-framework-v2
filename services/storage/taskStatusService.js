import { supabase } from "../../providers/storage/supabase.js";

export async function updateTaskStatus(taskId, status) {
  const { data: task, error: readError } = await supabase
    .from("memories")
    .select("*")
    .eq("id", taskId)
    .single();

  if (readError || !task) {
    return null;
  }

  const metadata = {
    ...task.metadata,
    status,
  };

  console.log("Updating task:", taskId);
console.log("New metadata:", metadata);

const { data, error: updateError } = await supabase
  .from("memories")
  .update({ metadata })
  .eq("id", taskId)
  .select();

console.log("Updated rows:", data);

if (updateError) {
  console.error("Update error:", updateError);
  return null;
}

  return {
    ...task,
    metadata,
  };
}