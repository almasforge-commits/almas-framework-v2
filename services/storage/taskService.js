import { supabase } from "../../providers/storage/supabase.js";

export async function getActiveTasks() {
  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("metadata->>memoryType", "task")
    .eq("metadata->>status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error.message);
    return [];
  }

  return data;
}
export async function getCompletedTasks() {
    const { data, error } = await supabase
      .from("memories")
      .select("*")
      .eq("metadata->>memoryType", "task")
      .eq("metadata->>status", "done")
      .order("created_at", { ascending: false });
  
    if (error) {
      console.error(error.message);
      return [];
    }
  
    return data;
  }