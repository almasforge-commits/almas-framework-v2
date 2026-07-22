/**
 * Optional loader for actor_finance_settings.base_currency.
 * Returns null when table/client unavailable — callers fall back to default VND.
 */

import { getSupabaseClient } from "../../providers/storage/supabase.js";

/**
 * @param {object} actor
 * @param {object} [deps]
 * @returns {Promise<string|null>}
 */
export async function loadActorBaseCurrencyPreference(actor, deps = {}) {
  const actorKey = actor?.actorKey || null;
  const userId =
    actor?.userId ||
    (actor?.telegramUserId != null ? String(actor.telegramUserId) : null);
  if (!actorKey && !userId) return null;

  try {
    const supabase =
      deps.supabase ||
      (typeof deps.getSupabaseClientFn === "function"
        ? deps.getSupabaseClientFn()
        : getSupabaseClient());
    if (!supabase) return null;

    let query = supabase
      .from("actor_finance_settings")
      .select("base_currency")
      .limit(1);
    if (actorKey) query = query.eq("actor_key", actorKey);
    else query = query.eq("user_id", userId);

    const { data, error } = await query.maybeSingle();
    if (error) return null;
    const currency = data?.base_currency;
    if (currency && /^[A-Z]{3}$/i.test(String(currency))) {
      return String(currency).toUpperCase();
    }
    return null;
  } catch {
    return null;
  }
}
