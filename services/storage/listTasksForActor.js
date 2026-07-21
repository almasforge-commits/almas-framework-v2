/**
 * Actor-scoped active/done tasks from the shared memories table.
 * Tasks are stored as memoryType=task with metadata.userId ownership.
 */

import { supabase } from "../../providers/storage/supabase.js";
import { filterMemoriesByActor } from "./memoryActorScope.js";

/**
 * @param {string} actorId - bare Telegram user id or telegram:<id>
 * @param {object} [opts]
 * @returns {Promise<object[]>}
 */
export async function listTasksForActor(actorId, opts = {}) {
  const id = String(actorId ?? "")
    .trim()
    .replace(/^telegram:/i, "");
  if (!id) return [];

  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 100);
  const status = opts.status === "done" ? "done" : "active";

  const { data, error } = await supabase
    .from("memories")
    .select("id, content, metadata, created_at, source, type")
    .eq("metadata->>memoryType", "task")
    .eq("metadata->>status", status)
    .or(
      [
        `metadata->>userId.eq.${id}`,
        `metadata->>user_id.eq.${id}`,
        `metadata->>chatId.eq.${id}`,
        `metadata->>chat_id.eq.${id}`,
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.log(`[tasks] action=list_actor ok=false`);
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  return filterMemoriesByActor(rows, { userId: id });
}
